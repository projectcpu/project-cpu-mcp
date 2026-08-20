import { describe, expect, it, vi } from 'vitest';

import { FakeMapSocket } from '../../../__mocks__/in-memory-socket.js';
import type { ServerHealthView } from '../../../api/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { makeCell, makeSnapshot } from '../../../map/__tests__/fixtures.js';
import { MapReader } from '../../../map/reader.js';
import { MapStore } from '../../../map/store.js';
import { MapSync } from '../../../map/sync.js';
import {
    type EnrichedCell,
    type IMapApi,
    type MapChanges,
    MapReadiness,
    type MapSnapshotResponse,
} from '../../../map/types.js';
import { FakeAppConfig, makeConfig } from '../../../services/__tests__/service-fakes.js';
import type { AppContext } from '../../../types.js';
import { formatUnixSeconds } from '../../../utils/format.utils.js';
import {
    PANEL_CONTINUATION_INDENT,
    PANEL_LABEL_SEPARATOR,
    PANEL_MAX_LABEL_LENGTH,
    PANEL_MAX_WIDTH,
    PANEL_STRUCTURAL_SEQUENCES,
} from '../../../utils/panel.constants.js';
import type { ToolRegistrar } from '../../types.js';
import { CHANGE_FEED_LABELS, CHANGE_FEED_TITLE } from '../get-changes/constants.js';
import { registerGetChangesTool } from '../get-changes/get-changes.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Handler = (args: unknown) => Promise<ToolResult>;

const RECORDED_MS = 1_700_000_123_456;

const CHANGED: EnrichedCell = {
    tokenId: '9',
    pos: { face: 0, i: 0, j: 9 },
    owner: '0xMe',
    revealCount: 1,
    revealPending: false,
    resources: [{ resourceId: 4, deposit: '50', balance: '0', strength: null, storage: null }],
    building: null,
    demolishFinishAt: null,
    demolishStartAt: null,
    demolishingType: null,
    transitFeeOverrides: null,
    saleFeeOverrides: null,
    process: null,
    updated: 5,
    ready: null,
    activeHub: false,
    neighbors: [],
};

const UP: ServerHealthView = { reachable: true, reason: null };
const DOWN: ServerHealthView = { reachable: false, reason: 'connect ECONNREFUSED 127.0.0.1:3000' };

interface HarnessOpts {
    health: ServerHealthView;
    readiness: MapReadiness;
    socketConnected: boolean;
    changes: Partial<MapChanges>;
}

function harness(opts: Partial<HarnessOpts> = {}): { handler: Handler; sinceArgs: Array<number> } {
    const sinceArgs: Array<number> = [];
    const map = {
        getChanges(since: number): MapChanges {
            sinceArgs.push(since);
            return {
                version: RECORDED_MS,
                serverTime: 1_700_000_000,
                changed: [CHANGED],
                changedCount: 1,
                ...opts.changes,
            };
        },
    };
    const wallet = { isReady: () => true, get: () => ({ getAddress: () => '0xMe' }) };
    const appConfig = {
        load: async (): Promise<{ resources: Record<number, string> }> => ({ resources: { 4: 'Iron Ore' } }),
    };
    const api = { getServerHealth: () => opts.health ?? UP };
    const mapSync = {
        getReadiness: () => opts.readiness ?? MapReadiness.Ready,
        isSocketConnected: () => opts.socketConnected ?? true,
    };
    const context = {
        mapReader: map,
        mapSync,
        wallet,
        appConfig,
        api,
        logger: new NoopLogger(),
    } as unknown as AppContext;

    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    registerGetChangesTool(server, context);
    if (captured === null) {
        throw new Error('get_changes was not registered');
    }
    return { handler: captured, sinceArgs };
}

describe('get_changes tool', () => {
    it('passes the provided version through', async () => {
        const { handler, sinceArgs } = harness();
        await handler({ sinceVersion: 120 });
        expect(sinceArgs[0]).toBe(120);
    });

    it('defaults a null version to 0 (return everything)', async () => {
        const { handler, sinceArgs } = harness();
        await handler({ sinceVersion: null });
        expect(sinceArgs[0]).toBe(0);
    });

    it('serializes the changes payload, with resource ids labeled from config', async () => {
        const { handler } = harness();
        const result = await handler({ sinceVersion: 0 });
        const parsed = JSON.parse(result.content[1]?.text ?? '{}') as {
            version: number;
            changed: Array<{ resources: Array<{ resourceName: string }> }>;
        };
        expect(parsed.version).toBe(RECORDED_MS);
        expect(parsed.changed[0]?.resources[0]?.resourceName).toBe('Iron Ore');
    });

    it('surfaces server reachability in the panel and payload', async () => {
        const { handler } = harness();
        const result = await handler({ sinceVersion: 0 });
        expect(result.content[0]?.text).toMatch(/Requests: answering/);
        const parsed = JSON.parse(result.content[1]?.text ?? '{}') as { server: { reachable: boolean } };
        expect(parsed.server.reachable).toBe(true);
    });
});

const PANEL_LABELS = Object.values(CHANGE_FEED_LABELS);

function panelOf(result: ToolResult): string {
    return result.content[0]?.text ?? '';
}

function labelSeparators(panel: string): number {
    return panel.split(PANEL_LABEL_SEPARATOR).length - 1;
}

function unwrapped(panel: string): string {
    return panel
        .split('\n')
        .reduce((text, line) =>
            line.startsWith(PANEL_CONTINUATION_INDENT) ? `${text} ${line.trim()}` : `${text}\n${line}`,
        );
}

function flattened(panel: string): string {
    return panel
        .split('\n')
        .map((line) => line.trim())
        .join('');
}

function panelLabels(panel: string): Array<string> {
    return panel
        .split('\n')
        .slice(1)
        .flatMap((line) => line.trim().split(' | '))
        .map((field) => field.split(': ')[0] ?? '')
        .filter((label) => PANEL_LABELS.includes(label));
}

const FROZEN = { changed: [], changedCount: 0 };

describe('get_changes panel', () => {
    it('opens with the same title and the same fields in the same order on every input', async () => {
        const panels = [
            panelOf(await harness().handler({ sinceVersion: 120 })),
            panelOf(await harness({ health: DOWN, readiness: MapReadiness.Degraded }).handler({ sinceVersion: 120 })),
            panelOf(
                await harness({ readiness: MapReadiness.Loading, changes: { version: 0, ...FROZEN } }).handler({
                    sinceVersion: null,
                }),
            ),
            panelOf(
                await harness({ readiness: MapReadiness.Stopped, socketConnected: false }).handler({
                    sinceVersion: null,
                }),
            ),
        ];

        for (const panel of panels) {
            expect(panel.split('\n')[0]).toBe(CHANGE_FEED_TITLE);
            expect(panelLabels(panel)).toEqual(PANEL_LABELS);
            expect(labelSeparators(panel)).toBe(PANEL_LABELS.length);
        }
    });

    it('keeps every line inside the panel width, whatever the values are', async () => {
        const noisy: ServerHealthView = { reachable: false, reason: `getaddrinfo ENOTFOUND ${'h'.repeat(120)}` };
        const panels = [
            panelOf(await harness().handler({ sinceVersion: 120 })),
            panelOf(await harness({ health: DOWN, readiness: MapReadiness.Degraded }).handler({ sinceVersion: 120 })),
            panelOf(await harness({ health: noisy, readiness: MapReadiness.Loading }).handler({ sinceVersion: 120 })),
            panelOf(
                await harness({ readiness: MapReadiness.Stopped, socketConnected: false }).handler({
                    sinceVersion: 120,
                }),
            ),
        ];

        for (const panel of panels) {
            for (const line of panel.split('\n')) {
                expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
            }
        }
    });

    it('reports the cursor it was given, what it found and when the map last advanced', async () => {
        const panel = panelOf(await harness().handler({ sinceVersion: 120 }));

        expect(panel).toMatch(/Since: v120/);
        expect(panel).toMatch(/Changed: 1/);
        expect(panel).toContain(`Last recorded: v${RECORDED_MS}`);
        expect(unwrapped(panel)).toContain(formatUnixSeconds(Math.floor(RECORDED_MS / 1000)));
        expect(panel).toMatch(/Source: game API/);
    });

    it('reads the map clock off what was recorded, never off the local clock', async () => {
        const early = panelOf(await harness({ changes: { version: RECORDED_MS } }).handler({ sinceVersion: 0 }));
        const later = panelOf(
            await harness({ changes: { version: RECORDED_MS + 3_600_000 } }).handler({ sinceVersion: 0 }),
        );

        expect(unwrapped(early)).toContain(formatUnixSeconds(Math.floor(RECORDED_MS / 1000)));
        expect(unwrapped(later)).toContain(formatUnixSeconds(Math.floor(RECORDED_MS / 1000) + 3600));
    });

    it('prints a missing value instead of dropping its field when nothing was recorded yet', async () => {
        const panel = panelOf(
            await harness({ readiness: MapReadiness.Loading, changes: { version: 0, ...FROZEN } }).handler({
                sinceVersion: 0,
            }),
        );

        expect(panel).toMatch(/Reason: n\/a/);
        expect(panel).toMatch(/Last advanced: n\/a/);
        expect(panelLabels(panel)).toEqual(PANEL_LABELS);
    });

    it('names the unreachable source and what it costs, instead of a soft maybe', async () => {
        const panel = panelOf(
            await harness({ health: DOWN, readiness: MapReadiness.Degraded, socketConnected: false }).handler({
                sinceVersion: 120,
            }),
        );

        expect(panel).toMatch(/Requests: UNREACHABLE/);
        expect(panel).toMatch(/Map: DEGRADED/);
        expect(panel).toMatch(/Reason: connect ECONNREFUSED/);
        expect(flattened(panel)).toMatch(/game API/);
        expect(flattened(panel)).toMatch(/stale/i);
        expect(flattened(panel)).not.toMatch(/may be|might be|possibly/i);
    });

    it('does not call the map live while the stream that feeds it is down', async () => {
        const panel = panelOf(
            await harness({ readiness: MapReadiness.Ready, socketConnected: false, changes: FROZEN }).handler({
                sinceVersion: 120,
            }),
        );

        expect(panel).toMatch(/Map: NO STREAM/);
        expect(panel).not.toMatch(/Map: live/);
        expect(flattened(panel)).toMatch(/nothing new can reach the map/i);
    });

    it('does not let an empty list read as a quiet world while the map is frozen', async () => {
        const quiet = panelOf(
            await harness({ readiness: MapReadiness.Degraded, socketConnected: false, changes: FROZEN }).handler({
                sinceVersion: 120,
            }),
        );

        expect(quiet).toMatch(/Changed: 0/);
        expect(flattened(quiet)).toMatch(/not quiet/i);
        expect(flattened(quiet)).toMatch(/stopped advancing/i);
    });

    it('lets the outage reason forge no line, no column and no field', async () => {
        const clean = panelOf(
            await harness({ health: { reachable: false, reason: 'socket hang up forged' } }).handler({
                sinceVersion: 1,
            }),
        );

        for (const probe of PANEL_STRUCTURAL_SEQUENCES) {
            const panel = panelOf(
                await harness({ health: { reachable: false, reason: `socket hang up${probe}forged` } }).handler({
                    sinceVersion: 1,
                }),
            );

            expect(panel.split('\n')).toHaveLength(clean.split('\n').length);
            expect(labelSeparators(panel)).toBe(labelSeparators(clean));
            expect(panel.split('|')).toHaveLength(clean.split('|').length);
        }
    });

    it('lets the outage reason forge no field even when the panel is read unwrapped', async () => {
        for (let offset = 40; offset < 72; offset += 1) {
            const reason = `${'b'.repeat(offset)}:${'c'.repeat(30)}`;
            const panel = panelOf(await harness({ health: { reachable: false, reason } }).handler({ sinceVersion: 1 }));

            expect(labelSeparators(unwrapped(panel))).toBe(PANEL_LABELS.length);
            expect(flattened(panel)).toContain(`Reason: ${reason}`);
            for (const line of panel.split('\n')) {
                expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
            }
        }
    });

    it('keeps its own labels inside the label ceiling the builder documents', () => {
        for (const label of PANEL_LABELS) {
            expect(label.length).toBeLessThanOrEqual(PANEL_MAX_LABEL_LENGTH);
        }
    });

    it('leaves the machine block untouched next to the panel', async () => {
        const result = await harness({ health: DOWN, readiness: MapReadiness.Degraded }).handler({ sinceVersion: 120 });

        expect(result.content).toHaveLength(2);
        expect(result.content[1]?.type).toBe('text');
        const payload = JSON.parse(result.content[1]?.text ?? '{}') as {
            version: number;
            changedCount: number;
            server: { reachable: boolean; reason: string | null };
        };
        expect(Object.keys(payload).sort()).toEqual(['changed', 'changedCount', 'server', 'serverTime', 'version']);
        expect(payload.version).toBe(RECORDED_MS);
        expect(payload.changedCount).toBe(1);
        expect(payload.server).toEqual(DOWN);
    });
});

class StubMapApi implements IMapApi {
    public calls = 0;

    constructor(
        private readonly status: number,
        private readonly snapshot: MapSnapshotResponse,
    ) {}

    async request<T>(): Promise<{ status: number; data: T }> {
        this.calls += 1;
        return { status: this.status, data: this.snapshot as T };
    }

    getBaseUrl(): string {
        return 'http://test';
    }
}

const SNAPSHOT_MS = 1_699_000_000_000;

// Everything below the socket and the map endpoint is the real thing: MapStore, MapSync, MapReader and the
// registered handler. `reachable: true` mirrors what ApiClient records for any parseable reply.
function liveHarness(status = 200): {
    handler: Handler;
    sync: MapSync;
    socket: FakeMapSocket;
    api: StubMapApi;
} {
    const store = new MapStore();
    const socket = new FakeMapSocket();
    const snapshot = makeSnapshot({
        version: SNAPSHOT_MS,
        serverTime: 1_699_000_000,
        cells: [makeCell({ tokenId: '1', owner: '0xMe', updated: SNAPSHOT_MS })],
    });
    const api = new StubMapApi(status, snapshot);
    const appConfig = new FakeAppConfig(makeConfig());
    const sync = new MapSync({
        store,
        api,
        backendVersion: { ensureFresh: async (): Promise<void> => undefined },
        socketFactory: () => socket,
        logger: new NoopLogger(),
        pollIntervalMs: 60_000,
        reconnectGraceMs: 5,
    });
    const mapReader = new MapReader({ store, status: sync, appConfig });
    const wallet = { isReady: () => true, get: () => ({ getAddress: () => '0xMe' }) };
    const context = {
        mapReader,
        mapSync: sync,
        wallet,
        appConfig,
        api: { getServerHealth: (): ServerHealthView => UP },
        logger: new NoopLogger(),
    } as unknown as AppContext;

    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    registerGetChangesTool(server, context);
    if (captured === null) {
        throw new Error('get_changes was not registered');
    }
    return { handler: captured, sync, socket, api };
}

function claimsCurrent(panel: string): boolean {
    const text = flattened(panel);
    return /\blive\b/iu.test(text) || /every (cell|change)/iu.test(text) || /is listed here/iu.test(text);
}

describe('get_changes panel against a real map sync', () => {
    it('calls the map live once the snapshot has landed and the stream is up', async () => {
        const { handler, sync, socket } = liveHarness();
        sync.start();
        socket.emitConnect();
        await vi.waitFor(() => expect(sync.getReadiness()).toBe(MapReadiness.Ready));

        const panel = panelOf(await handler({ sinceVersion: 0 }));
        expect(panel).toMatch(/Map: live/);
        expect(panel).toMatch(/Stream: connected/);
        sync.stop();
    });

    it('does not call the feed live before the map sync has even started', async () => {
        const { handler, sync } = liveHarness();

        const panel = panelOf(await handler({ sinceVersion: 0 }));
        expect(sync.getReadiness()).toBe(MapReadiness.Stopped);
        expect(panel).toMatch(/Map: STOPPED/);
        expect(panel).toMatch(/Changed: 0/);
        expect(claimsCurrent(panel)).toBe(false);
    });

    it('does not call the feed live when the map endpoint answers with a non-200 body', async () => {
        const { handler, sync, socket, api } = liveHarness(500);
        sync.start();
        socket.emitConnect();
        await vi.waitFor(() => expect(api.calls).toBeGreaterThan(0));
        await vi.waitFor(() => expect(sync.getReadiness()).toBe(MapReadiness.Loading));

        const panel = panelOf(await handler({ sinceVersion: 0 }));
        expect(panel).toMatch(/Map: LOADING/);
        expect(panel).toMatch(/Changed: 0/);
        expect(panel).toMatch(/Requests: answering/);
        expect(claimsCurrent(panel)).toBe(false);
        sync.stop();
    });

    it('does not call the feed live while the map is frozen behind a dropped stream', async () => {
        const { handler, sync, socket } = liveHarness();
        sync.start();
        socket.emitConnect();
        await vi.waitFor(() => expect(sync.getReadiness()).toBe(MapReadiness.Ready));

        socket.emitDisconnect();
        await vi.waitFor(() => expect(sync.getReadiness()).toBe(MapReadiness.Degraded));

        const panel = panelOf(await handler({ sinceVersion: SNAPSHOT_MS }));
        expect(panel).toMatch(/Map: DEGRADED/);
        expect(panel).toMatch(/Stream: dropped/);
        expect(panel).toMatch(/Changed: 0/);
        expect(claimsCurrent(panel)).toBe(false);
        expect(flattened(panel)).toMatch(/not quiet/i);
        sync.stop();
    });
});
