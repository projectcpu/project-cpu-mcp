import { MAP_HTTP_PATH, SERVER_INITIATED_DISCONNECT_REASON, STARTUP_FETCH_RETRY_MS } from './constants.js';
import { parseSnapshot } from './map.utils.js';
import type { MapStore } from './store.js';
import {
    type IMapApi,
    type ISocketClient,
    MapReadiness,
    type MapSocketFactory,
    type MapSnapshotResponse,
    type MapStatus,
    type MapSyncOptions,
    type ParsedSnapshot,
    type RawCell,
} from './types.js';
import { HttpStatus } from '../api/types.js';
import type { ILogger } from '../logger/types.js';
import { errorMessage } from '../utils/error.utils.js';
import type { IBackendVersion } from '../version/types.js';

/**
 * Keeps the store current: loads the initial snapshot, subscribes to the realtime stream, and
 * resyncs/polls around disconnects. Built so an unreachable or flaky source never crashes the
 * process — failures degrade to retries/polling and reads simply report staleness via readiness.
 */
export class MapSync implements MapStatus {
    private readonly store: MapStore;
    private readonly api: IMapApi;
    private readonly backendVersion: IBackendVersion;
    private readonly socketFactory: MapSocketFactory;
    private readonly logger: ILogger;
    private readonly pollIntervalMs: number;
    private readonly reconnectGraceMs: number;
    private socket: ISocketClient | null = null;
    private readiness = MapReadiness.Stopped;
    private ready = false;
    private pollTimer: ReturnType<typeof setInterval> | null = null;
    private degradeTimer: ReturnType<typeof setTimeout> | null = null;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    private resyncPaused = false;
    private droppedInFullSnapshot = 0;
    private generation = 0;

    constructor(options: MapSyncOptions) {
        this.store = options.store;
        this.api = options.api;
        this.backendVersion = options.backendVersion;
        this.socketFactory = options.socketFactory;
        this.logger = options.logger;
        this.pollIntervalMs = options.pollIntervalMs;
        this.reconnectGraceMs = options.reconnectGraceMs;
    }

    start(): void {
        if (this.readiness !== MapReadiness.Stopped) {
            return;
        }
        this.readiness = MapReadiness.Loading;
        this.logger.info('starting map sync');

        // Connect first so realtime updates buffer into the store before the snapshot lands; the
        // newer-wins merge then guarantees a fresh event isn't overwritten by an older snapshot cell.
        this.socket = this.socketFactory({ baseUrl: this.api.getBaseUrl(), logger: this.logger.child('socket') });
        this.socket.connect({
            onConnect: () => this.handleConnect(),
            onDisconnect: (reason) => this.handleDisconnect(reason),
            onError: (error) => this.handleError(error),
            onCellUpdate: (cell) => this.handleCellUpdate(cell),
        });

        void this.bootstrapSnapshot();
    }

    getReadiness(): MapReadiness {
        return this.readiness;
    }

    isSocketConnected(): boolean {
        return this.socket?.isConnected() ?? false;
    }

    async resyncNow(): Promise<void> {
        await this.resync();
    }

    stop(): void {
        this.stopPolling();
        this.clearDegradeTimer();
        if (this.retryTimer !== null) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
        if (this.socket !== null) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.generation += 1;
        this.ready = false;
        this.readiness = MapReadiness.Stopped;
    }

    async pauseResync(run: () => Promise<void>): Promise<void> {
        this.resyncPaused = true;
        try {
            await run();
        } finally {
            this.resyncPaused = false;
        }
    }

    async fetchFullSnapshot(): Promise<MapSnapshotResponse> {
        const { snapshot, dropped } = await this.fetchSnapshot(MAP_HTTP_PATH);
        this.droppedInFullSnapshot = dropped;
        if (dropped > 0) {
            this.logger.warn('dropped invalid cells from map snapshot', { dropped });
        }
        return snapshot;
    }

    applyFullSnapshot(snapshot: MapSnapshotResponse): void {
        this.generation += 1;
        this.store.replaceAll(snapshot);
        this.store.noteDroppedCells(this.droppedInFullSnapshot);
        this.droppedInFullSnapshot = 0;
        this.logger.info('map replaced from a full snapshot', {
            cells: this.store.size(),
            version: this.store.getSyncVersion(),
        });
        this.markReady();
    }

    private async bootstrapSnapshot(): Promise<void> {
        try {
            await this.backendVersion.ensureFresh();
        } catch (error) {
            this.logger.error('reloading state for the new game API build failed — retrying', {
                error: errorMessage(error),
            });
            this.scheduleRetry();
            return;
        }

        if (this.ready) {
            return;
        }

        try {
            const generation = this.generation;
            const { snapshot, dropped } = await this.fetchSnapshot(MAP_HTTP_PATH);
            if (generation !== this.generation) {
                return;
            }
            this.store.applySnapshot(snapshot);
            this.store.noteDroppedCells(dropped);
            if (dropped > 0) {
                this.logger.warn('dropped invalid cells from map snapshot', { dropped });
            }
            this.logger.info('map snapshot loaded', { cells: this.store.size(), version: this.store.getSyncVersion() });
            this.markReady();
        } catch (error) {
            this.logger.error('map snapshot load failed — retrying', { error: errorMessage(error) });
            this.scheduleRetry();
        }
    }

    private async fetchSnapshot(path: string): Promise<ParsedSnapshot> {
        const { status, data } = await this.api.request<unknown>(path);
        if (status !== HttpStatus.Ok) {
            throw new Error(`map request returned ${status}`);
        }
        return parseSnapshot(data);
    }

    private async resync(): Promise<void> {
        if (this.resyncPaused) {
            return;
        }
        const generation = this.generation;
        const since = this.store.getSyncVersion();
        try {
            const { snapshot, dropped } = await this.fetchSnapshot(`${MAP_HTTP_PATH}?since=${since}`);
            if (generation !== this.generation) {
                return;
            }
            this.store.applySnapshot(snapshot);
            this.store.noteDroppedCells(dropped);
            this.logger.info('map resynced', {
                since,
                changed: snapshot.cells.length,
                dropped,
                version: this.store.getSyncVersion(),
            });
        } catch (error) {
            this.logger.warn('map resync failed', { error: errorMessage(error) });
        }
    }

    private handleConnect(): void {
        this.logger.info('map socket connected');
        this.clearDegradeTimer();
        this.stopPolling();
        if (this.readiness === MapReadiness.Degraded) {
            this.readiness = MapReadiness.Ready;
        }
        // A first connect before the snapshot is covered by the bootstrap fetch; once we have a
        // server-vouched version, a reconnect needs a delta to backfill events missed while down.
        if (this.store.getSyncVersion() > 0) {
            void this.resync();
        }
    }

    private handleDisconnect(reason: string): void {
        this.logger.warn('map socket disconnected', { reason });
        // socket.io does not auto-reconnect after a server-initiated disconnect — drive it once,
        // which re-arms socket.io's own backoff loop. Other reasons it recovers on its own.
        if (reason === SERVER_INITIATED_DISCONNECT_REASON) {
            this.socket?.reconnect();
        }
        if (this.degradeTimer !== null || !this.ready) {
            return;
        }
        this.degradeTimer = setTimeout(() => {
            this.degradeTimer = null;
            this.readiness = MapReadiness.Degraded;
            this.startPolling();
        }, this.reconnectGraceMs);
    }

    private handleError(error: Error): void {
        this.logger.warn('map socket error', { error: error.message });
    }

    private handleCellUpdate(cell: RawCell): void {
        if (this.store.applyCell(cell)) {
            this.logger.debug('cell updated', { tokenId: cell.tokenId, latest: this.store.getLatestUpdated() });
        }
    }

    private markReady(): void {
        this.ready = true;
        if (this.readiness === MapReadiness.Loading) {
            this.readiness = MapReadiness.Ready;
        }
    }

    private scheduleRetry(): void {
        if (this.retryTimer !== null) {
            return;
        }
        this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            void this.bootstrapSnapshot();
        }, STARTUP_FETCH_RETRY_MS);
    }

    private startPolling(): void {
        if (this.pollTimer !== null || !this.ready) {
            return;
        }
        this.pollTimer = setInterval(() => {
            // Backstop: if the socket is still down, nudge a reconnect (idempotent) before polling, so
            // recovery happens even if socket.io's own loop stopped (e.g. finite reconnectionAttempts).
            if (this.socket !== null && !this.socket.isConnected()) {
                this.socket.reconnect();
            }
            void this.resync();
        }, this.pollIntervalMs);
    }

    private stopPolling(): void {
        if (this.pollTimer !== null) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    private clearDegradeTimer(): void {
        if (this.degradeTimer !== null) {
            clearTimeout(this.degradeTimer);
            this.degradeTimer = null;
        }
    }
}
