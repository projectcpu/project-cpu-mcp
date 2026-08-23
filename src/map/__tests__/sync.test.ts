import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { FakeMapSocket } from '../../__mocks__/in-memory-socket.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { FakeAppConfig, makeConfig } from '../../services/__tests__/service-fakes.js';
import { BackendVersion, createBackendVersionGate } from '../../version/backend-version.js';
import { BACKEND_RESET_NOTICE, BACKEND_VERSION_TTL_MS } from '../../version/constants.js';
import { createNoticeBuffer, guardToolHandler } from '../../version/tool-guard.js';
import type { IBackendVersion } from '../../version/types.js';
import { STARTUP_FETCH_RETRY_MS } from '../constants.js';
import { MapReader } from '../reader.js';
import { MapStore } from '../store.js';
import { MapSync } from '../sync.js';
import { type IMapApi, MapReadiness, type RawCell } from '../types.js';
import { makeCell, makeSnapshot } from './fixtures.js';

function textOf(result: CallToolResult): Array<string> {
    return (result.content ?? []).map((block) => (block.type === 'text' ? block.text : block.type));
}

class FakeApi implements IMapApi {
    public readonly calls: Array<string> = [];
    public snapshotVersion = 50;
    public snapshotCells: Array<RawCell>;
    public resyncCells: Array<RawCell> = [];

    constructor(
        snapshotCells: Array<RawCell>,
        private readonly trace: Array<string> = [],
    ) {
        this.snapshotCells = snapshotCells;
    }

    async request<T>(path: string): Promise<{ status: number; data: T }> {
        this.calls.push(path);
        this.trace.push('map-request');
        const cells = path.includes('since=') ? this.resyncCells : this.snapshotCells;
        const data = makeSnapshot({ version: this.snapshotVersion, serverTime: 1000, cells }) as T;
        return { status: 200, data };
    }

    getBaseUrl(): string {
        return 'http://test';
    }
}

class FakeBackendVersion implements IBackendVersion {
    public calls = 0;

    constructor(private readonly trace: Array<string> = []) {}

    async ensureFresh(): Promise<void> {
        this.calls += 1;
        this.trace.push('version-probe');
    }
}

const GRACE_MS = 1000;
const POLL_MS = 1000;

function setup(snapshotCells: Array<RawCell>): {
    sync: MapSync;
    socket: FakeMapSocket;
    api: FakeApi;
    store: MapStore;
    backendVersion: FakeBackendVersion;
    trace: Array<string>;
} {
    const trace: Array<string> = [];
    const store = new MapStore();
    const socket = new FakeMapSocket();
    const api = new FakeApi(snapshotCells, trace);
    const backendVersion = new FakeBackendVersion(trace);
    const sync = new MapSync({
        store,
        api,
        backendVersion,
        socketFactory: () => socket,
        logger: new NoopLogger(),
        pollIntervalMs: POLL_MS,
        reconnectGraceMs: GRACE_MS,
    });
    return { sync, socket, api, store, backendVersion, trace };
}

async function waitReady(sync: MapSync): Promise<void> {
    await vi.waitFor(() => expect(sync.getReadiness()).toBe(MapReadiness.Ready));
}

describe('MapSync', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('loads the snapshot and becomes ready', async () => {
        const { sync, store } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await waitReady(sync);

        expect(sync.getReadiness()).toBe(MapReadiness.Ready);
        expect(store.size()).toBe(1);
    });

    it('remembers the snapshot rows it could not read, so a reader can refuse to guess at them', async () => {
        const { sync, store } = setup([
            makeCell({ tokenId: '1', updated: 50 }),
            { tokenId: '2' } as unknown as RawCell,
        ]);
        sync.start();
        await waitReady(sync);

        expect(store.size()).toBe(1);
        expect(store.getDroppedCells()).toBe(1);
    });

    it('counts a realtime update it could not read, so a loaded map stops passing for whole', async () => {
        const { sync, socket, store } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await waitReady(sync);
        const reader = new MapReader({ store, status: sync, appConfig: new FakeAppConfig(makeConfig()) });
        expect((await reader.routingSnapshot()).complete).toBe(true);

        socket.emitUnreadableCell();

        const routing = await reader.routingSnapshot();
        expect(routing.droppedCells).toBe(1);
        expect(routing.complete).toBe(false);
    });

    it('counts the resync rows it could not read', async () => {
        const { sync, api, store } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await waitReady(sync);
        expect(store.getDroppedCells()).toBe(0);

        api.resyncCells = [{ tokenId: '2' } as unknown as RawCell];
        await sync.resyncNow();

        expect(store.getDroppedCells()).toBe(1);
    });

    it('counts the rows it could not read while replacing the whole map', async () => {
        const { sync, api, store } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await waitReady(sync);

        api.snapshotCells = [makeCell({ tokenId: '2', updated: 2 }), { tokenId: '3' } as unknown as RawCell];
        sync.applyFullSnapshot(await sync.fetchFullSnapshot());

        expect(store.size()).toBe(1);
        expect(store.getDroppedCells()).toBe(1);
    });

    it('does not carry an unreadable-row count from one full replacement into the next', async () => {
        const { sync, api, store } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await waitReady(sync);
        api.snapshotCells = [makeCell({ tokenId: '2', updated: 2 }), { tokenId: '3' } as unknown as RawCell];
        sync.applyFullSnapshot(await sync.fetchFullSnapshot());
        expect(store.getDroppedCells()).toBe(1);

        api.snapshotCells = [makeCell({ tokenId: '4', updated: 4 })];
        sync.applyFullSnapshot(await sync.fetchFullSnapshot());

        expect(store.getDroppedCells()).toBe(0);
    });

    it('checks the source build before it asks for the first snapshot', async () => {
        const { sync, backendVersion, trace } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await waitReady(sync);

        expect(backendVersion.calls).toBe(1);
        expect(trace[0]).toBe('version-probe');
        expect(trace[1]).toBe('map-request');
    });

    it('fetches a full snapshot without touching the map it holds', async () => {
        const { sync, api, store } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await waitReady(sync);
        expect(store.getSyncVersion()).toBe(50);

        api.snapshotVersion = 2;
        api.snapshotCells = [makeCell({ tokenId: '2', updated: 2 })];
        const snapshot = await sync.fetchFullSnapshot();

        expect(api.calls.at(-1)).toBe('/api/v1/map');
        expect(snapshot.version).toBe(2);
        expect(store.getSyncVersion()).toBe(50);
        expect(store.get('1')).not.toBeNull();
    });

    it('replaces the map and rewinds the cursor only when the snapshot is applied', async () => {
        const { sync, api, store } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await waitReady(sync);

        api.snapshotVersion = 2;
        api.snapshotCells = [makeCell({ tokenId: '2', updated: 2 })];
        sync.applyFullSnapshot(await sync.fetchFullSnapshot());

        expect(store.getSyncVersion()).toBe(2);
        expect(store.get('1')).toBeNull();
        expect(store.get('2')).not.toBeNull();
    });

    it('reports a failed full fetch instead of swallowing it', async () => {
        const { sync, api } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await waitReady(sync);

        vi.spyOn(api, 'request').mockResolvedValueOnce({ status: 503, data: null });

        await expect(sync.fetchFullSnapshot()).rejects.toThrow('map request returned 503');
    });

    it('drops a delta that was in flight while the map was replaced', async () => {
        const { sync, store, api } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await waitReady(sync);

        let releaseDelta: () => void = () => undefined;
        const delta = new Promise<void>((resolve) => {
            releaseDelta = resolve;
        });
        vi.spyOn(api, 'request').mockImplementationOnce(async () => {
            await delta;
            return { status: 200, data: makeSnapshot({ version: 50, serverTime: 1000, cells: [] }) };
        });

        const pending = sync.resyncNow();
        sync.applyFullSnapshot(makeSnapshot({ version: 2, serverTime: 1000, cells: [] }));
        releaseDelta();
        await pending;

        expect(store.getSyncVersion()).toBe(2);
    });

    it('drops a bootstrap snapshot that was still in flight when the map was replaced', async () => {
        const { sync, api, store } = setup([]);

        let releaseBootstrap: () => void = () => undefined;
        let bootstrapAsked = false;
        const hung = new Promise<void>((resolve) => {
            releaseBootstrap = resolve;
        });
        vi.spyOn(api, 'request').mockImplementationOnce(async () => {
            bootstrapAsked = true;
            await hung;
            return {
                status: 200,
                data: makeSnapshot({
                    version: 900,
                    serverTime: 1000,
                    cells: [makeCell({ tokenId: 'old', updated: 900 })],
                }),
            };
        });

        sync.start();
        await vi.waitFor(() => expect(bootstrapAsked).toBe(true));

        sync.applyFullSnapshot(
            makeSnapshot({ version: 3, serverTime: 1000, cells: [makeCell({ tokenId: 'new', updated: 2 })] }),
        );
        releaseBootstrap();
        await new Promise((resolve) => setTimeout(resolve, 0));

        expect(store.getSyncVersion()).toBe(3);
        expect(store.get('old')).toBeNull();
        expect(store.get('new')).not.toBeNull();
    });

    it('skips the bootstrap fetch when the version probe already replaced the map', async () => {
        const store = new MapStore();
        const api = new FakeApi([makeCell({ tokenId: 'bootstrap', updated: 50 })]);
        let sync: MapSync | null = null;
        const backendVersion: IBackendVersion = {
            ensureFresh: async () => {
                sync?.applyFullSnapshot(
                    makeSnapshot({ version: 7, serverTime: 1000, cells: [makeCell({ tokenId: 'reset', updated: 7 })] }),
                );
            },
        };
        sync = new MapSync({
            store,
            api,
            backendVersion,
            socketFactory: () => new FakeMapSocket(),
            logger: new NoopLogger(),
            pollIntervalMs: POLL_MS,
            reconnectGraceMs: GRACE_MS,
        });

        sync.start();
        await waitReady(sync);

        expect(api.calls).toEqual([]);
        expect(store.getSyncVersion()).toBe(7);
        expect(store.get('bootstrap')).toBeNull();
        expect(store.get('reset')).not.toBeNull();
    });

    it('loads the map again when it is started after a stop', async () => {
        const { sync, api, store } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await waitReady(sync);
        const afterFirstStart = api.calls.length;

        sync.stop();
        expect(sync.getReadiness()).toBe(MapReadiness.Stopped);

        sync.start();
        await waitReady(sync);

        expect(api.calls.length).toBeGreaterThan(afterFirstStart);
        expect(store.size()).toBe(1);
    });

    it('drops a bootstrap snapshot that lands after a stop, so the next start reloads', async () => {
        const { sync, api, store } = setup([makeCell({ tokenId: '1', updated: 50 })]);

        let releaseBootstrap: () => void = () => undefined;
        let bootstrapAsked = false;
        const hung = new Promise<void>((resolve) => {
            releaseBootstrap = resolve;
        });
        vi.spyOn(api, 'request').mockImplementationOnce(async () => {
            bootstrapAsked = true;
            await hung;
            return {
                status: 200,
                data: makeSnapshot({
                    version: 900,
                    serverTime: 1000,
                    cells: [makeCell({ tokenId: 'stale', updated: 900 })],
                }),
            };
        });

        sync.start();
        await vi.waitFor(() => expect(bootstrapAsked).toBe(true));

        sync.stop();
        releaseBootstrap();
        await new Promise((resolve) => setTimeout(resolve, 0));

        sync.start();
        await waitReady(sync);

        expect(store.get('stale')).toBeNull();
        expect(store.get('1')).not.toBeNull();
    });

    it('lifts the resync pause when the reset it wraps throws', async () => {
        const { sync, api } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await waitReady(sync);

        await expect(
            sync.pauseResync(async () => {
                throw new Error('Failed to load chain config (HTTP 502)');
            }),
        ).rejects.toThrow('Failed to load chain config');

        const afterFailedReset = api.calls.length;
        await sync.resyncNow();

        expect(api.calls.length).toBe(afterFailedReset + 1);
    });

    it('still retries the bootstrap when the version probe fails', async () => {
        vi.useFakeTimers();
        const store = new MapStore();
        const api = new FakeApi([makeCell({ tokenId: '1', updated: 50 })]);
        let probeFails = true;
        const backendVersion: IBackendVersion = {
            ensureFresh: async () => {
                if (probeFails) {
                    probeFails = false;
                    throw new Error('reloading state for the new build failed');
                }
            },
        };
        const sync = new MapSync({
            store,
            api,
            backendVersion,
            socketFactory: () => new FakeMapSocket(),
            logger: new NoopLogger(),
            pollIntervalMs: POLL_MS,
            reconnectGraceMs: GRACE_MS,
        });

        sync.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(api.calls).toEqual([]);
        expect(sync.getReadiness()).toBe(MapReadiness.Loading);

        await vi.advanceTimersByTimeAsync(STARTUP_FETCH_RETRY_MS);

        expect(sync.getReadiness()).toBe(MapReadiness.Ready);
        expect(store.size()).toBe(1);
    });

    it('holds the poller back across the whole reset, not just the fetch', async () => {
        vi.useFakeTimers();
        const { sync, socket, api } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await vi.advanceTimersByTimeAsync(0);

        socket.emitDisconnect();
        await vi.advanceTimersByTimeAsync(GRACE_MS);
        expect(sync.getReadiness()).toBe(MapReadiness.Degraded);

        let polledWhileResetting = 0;
        await sync.pauseResync(async () => {
            const snapshot = await sync.fetchFullSnapshot();
            const before = api.calls.length;
            await vi.advanceTimersByTimeAsync(POLL_MS * 2);
            polledWhileResetting = api.calls.length - before;
            sync.applyFullSnapshot(snapshot);
        });

        const afterReset = api.calls.length;
        await vi.advanceTimersByTimeAsync(POLL_MS);

        expect(polledWhileResetting).toBe(0);
        expect(api.calls.length).toBeGreaterThan(afterReset);
    });

    it('keeps a realtime cell that arrived before an older snapshot', async () => {
        const { sync, socket, store } = setup([makeCell({ tokenId: '1', updated: 50, owner: '0xsnapshot' })]);

        sync.start();
        socket.emitCell(makeCell({ tokenId: '1', updated: 100, owner: '0xlive' }));
        await waitReady(sync);

        expect(store.get('1')?.owner).toBe('0xlive');
    });

    it('resyncs with ?since on a reconnect once a version is known', async () => {
        const { sync, socket, api } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await waitReady(sync);

        socket.emitConnect();

        expect(api.calls).toContain('/api/v1/map?since=50');
    });

    it('degrades and polls while the socket stays down', async () => {
        vi.useFakeTimers();
        const { sync, socket, api } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await vi.advanceTimersByTimeAsync(0);

        socket.emitDisconnect();
        await vi.advanceTimersByTimeAsync(GRACE_MS);
        expect(sync.getReadiness()).toBe(MapReadiness.Degraded);

        const before = api.calls.length;
        await vi.advanceTimersByTimeAsync(POLL_MS);
        expect(api.calls.length).toBeGreaterThan(before);
    });

    it('does not throw on a socket error', async () => {
        const { sync, socket } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await waitReady(sync);

        expect(() => socket.emitError(new Error('boom'))).not.toThrow();
        expect(sync.getReadiness()).toBe(MapReadiness.Ready);
    });

    it('reports socket connectivity', async () => {
        const { sync, socket } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await waitReady(sync);

        socket.emitConnect();
        expect(sync.isSocketConnected()).toBe(true);
        socket.emitDisconnect();
        expect(sync.isSocketConnected()).toBe(false);
    });

    it('manually reconnects after a server-initiated disconnect and resyncs once back', async () => {
        const { sync, socket, api } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await waitReady(sync);

        socket.emitDisconnect('io server disconnect');
        expect(socket.reconnectCalls).toBeGreaterThanOrEqual(1);

        socket.emitConnect();
        expect(api.calls).toContain('/api/v1/map?since=50');
        expect(sync.getReadiness()).toBe(MapReadiness.Ready);
        expect(sync.isSocketConnected()).toBe(true);
    });

    it('nudges a reconnect on each poll tick while degraded (backstop)', async () => {
        vi.useFakeTimers();
        const { sync, socket } = setup([makeCell({ tokenId: '1', updated: 50 })]);
        sync.start();
        await vi.advanceTimersByTimeAsync(0);

        // reason 'test' is not server-initiated, so there's no immediate reconnect.
        socket.emitDisconnect();
        await vi.advanceTimersByTimeAsync(GRACE_MS);
        expect(sync.getReadiness()).toBe(MapReadiness.Degraded);

        const before = socket.reconnectCalls;
        await vi.advanceTimersByTimeAsync(POLL_MS);
        expect(socket.reconnectCalls).toBeGreaterThan(before);
    });
});

describe('MapSync and the tool-call gate', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('leaves the reset notice for the first tool call when a bootstrap retry triggers the reset', async () => {
        vi.useFakeTimers();

        let mapStatus = 503;
        let sha = 'sha-1';
        let now = 0;
        let resets = 0;

        const api: IMapApi = {
            getBaseUrl: () => 'http://test',
            request: async <T>(): Promise<{ status: number; data: T }> => ({
                status: mapStatus,
                data: makeSnapshot({ version: 3, serverTime: 1000, cells: [] }) as T,
            }),
        };

        const carrier = new BackendVersion({
            probe: async () => sha,
            nowMs: () => now,
            ttlMs: BACKEND_VERSION_TTL_MS,
            onChange: async (): Promise<void> => void (resets += 1),
            logger: new NoopLogger(),
        });

        const sync = new MapSync({
            store: new MapStore(),
            api,
            backendVersion: carrier,
            socketFactory: () => new FakeMapSocket(),
            logger: new NoopLogger(),
            pollIntervalMs: POLL_MS,
            reconnectGraceMs: GRACE_MS,
        });

        sync.start();
        await vi.advanceTimersByTimeAsync(0);
        expect(resets).toBe(0);

        sha = 'sha-2';
        now += BACKEND_VERSION_TTL_MS;
        mapStatus = 200;
        await vi.advanceTimersByTimeAsync(STARTUP_FETCH_RETRY_MS);
        expect(resets).toBe(1);

        const guarded = guardToolHandler(
            'cpu_get_map',
            [createBackendVersionGate(carrier)],
            () => ({ content: [{ type: 'text' as const, text: 'done' }] }),
            createNoticeBuffer(),
        );

        expect(textOf(await guarded())).toEqual(['done', BACKEND_RESET_NOTICE]);
        expect(textOf(await guarded())).toEqual(['done']);
    });
});
