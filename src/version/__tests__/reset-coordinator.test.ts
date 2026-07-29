import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../logger/noop.logger.js';
import { makeCell, makeSnapshot } from '../../map/__tests__/fixtures.js';
import { MapStore } from '../../map/store.js';
import type { MapSnapshotResponse } from '../../map/types.js';
import type { AppConfig } from '../../services/types.js';
import { BackendVersion } from '../backend-version.js';
import { ResetCoordinator } from '../reset-coordinator.js';
import type { ICachedFromConfig, IFullMapLoader, IReplaceableAppConfig } from '../types.js';

const TTL_MS = 60_000;

const OLD_CONFIG = { chainId: 1 } as AppConfig;
const NEW_CONFIG = { chainId: 2 } as AppConfig;

const OLD_WORLD = makeSnapshot({
    version: 900,
    serverTime: 9000,
    cells: [makeCell({ tokenId: 'old', updated: 900 })],
});

const NEW_WORLD = makeSnapshot({
    version: 3,
    serverTime: 20,
    cells: [makeCell({ tokenId: 'new', updated: 2 })],
});

class FakeAppConfig implements IReplaceableAppConfig {
    public held: AppConfig = OLD_CONFIG;
    public failWith: string | null = null;
    public fetches = 0;

    async fetch(): Promise<AppConfig> {
        this.fetches += 1;
        if (this.failWith !== null) {
            throw new Error(this.failWith);
        }
        return NEW_CONFIG;
    }

    replace(config: AppConfig): void {
        this.held = config;
    }

    async load(): Promise<AppConfig> {
        return this.held;
    }
}

class FakeMapSync implements IFullMapLoader {
    public failWith: string | null = null;
    public fetches = 0;
    public paused = false;
    public pausedWhileSwapping = false;

    constructor(private readonly store: MapStore) {}

    async pauseResync(run: () => Promise<void>): Promise<void> {
        this.paused = true;
        try {
            await run();
        } finally {
            this.paused = false;
        }
    }

    async fetchFullSnapshot(): Promise<MapSnapshotResponse> {
        this.fetches += 1;
        if (this.failWith !== null) {
            throw new Error(this.failWith);
        }
        return NEW_WORLD;
    }

    applyFullSnapshot(snapshot: MapSnapshotResponse): void {
        this.pausedWhileSwapping = this.paused;
        this.store.replaceAll(snapshot);
    }
}

class FakeCache implements ICachedFromConfig {
    public held: string | null = 'derived-from-the-old-config';

    invalidateCache(): void {
        this.held = null;
    }
}

interface Harness {
    store: MapStore;
    appConfig: FakeAppConfig;
    map: FakeMapSync;
    swap: FakeCache;
    syndicate: FakeCache;
    coordinator: ResetCoordinator;
}

function setup(): Harness {
    const store = new MapStore(() => 0);
    store.applySnapshot(OLD_WORLD);

    const appConfig = new FakeAppConfig();
    const map = new FakeMapSync(store);
    const swap = new FakeCache();
    const syndicate = new FakeCache();
    const coordinator = new ResetCoordinator({
        appConfig,
        mapSync: map,
        swap,
        syndicate,
        logger: new NoopLogger(),
    });
    return { store, appConfig, map, swap, syndicate, coordinator };
}

function expectUntouched(harness: Harness): void {
    expect(harness.appConfig.held).toBe(OLD_CONFIG);
    expect(harness.store.get('old')).not.toBeNull();
    expect(harness.store.get('new')).toBeNull();
    expect(harness.store.getSyncVersion()).toBe(900);
    expect(harness.store.getLatestUpdated()).toBe(900);
    expect(harness.store.getServerTime()).toBe(9000);
    expect(harness.swap.held).toBe('derived-from-the-old-config');
    expect(harness.syndicate.held).toBe('derived-from-the-old-config');
}

function makeCarrier(options: {
    probe: () => Promise<string | null>;
    nowMs: () => number;
    onChange: () => Promise<void>;
}): BackendVersion {
    return new BackendVersion({
        probe: options.probe,
        nowMs: options.nowMs,
        ttlMs: TTL_MS,
        onChange: options.onChange,
        logger: new NoopLogger(),
    });
}

describe('ResetCoordinator', () => {
    it('swaps config, map and the caches derived from them', async () => {
        const harness = setup();

        await harness.coordinator.reset();

        expect(harness.appConfig.held).toBe(NEW_CONFIG);
        expect(harness.store.get('old')).toBeNull();
        expect(harness.store.get('new')).not.toBeNull();
        expect(harness.store.getSyncVersion()).toBe(3);
        expect(harness.store.getLatestUpdated()).toBe(2);
        expect(harness.store.getServerTime()).toBe(20);
        expect(harness.swap.held).toBeNull();
        expect(harness.syndicate.held).toBeNull();
    });

    it('holds map resyncs back across the swap, not just the load', async () => {
        const harness = setup();

        await harness.coordinator.reset();

        expect(harness.map.pausedWhileSwapping).toBe(true);
        expect(harness.map.paused).toBe(false);
    });

    it('lets resyncs run again after a failed reset', async () => {
        const harness = setup();
        harness.map.failWith = 'map request returned 502';

        await expect(harness.coordinator.reset()).rejects.toThrow('map request returned 502');

        expect(harness.map.paused).toBe(false);
    });

    it('leaves every piece of state on the old build when the map load fails', async () => {
        const harness = setup();
        harness.map.failWith = 'map request returned 502';

        await expect(harness.coordinator.reset()).rejects.toThrow('map request returned 502');
        expectUntouched(harness);
    });

    it('leaves every piece of state on the old build when the config load fails', async () => {
        const harness = setup();
        harness.appConfig.failWith = 'Failed to load chain config (HTTP 502)';

        await expect(harness.coordinator.reset()).rejects.toThrow('Failed to load chain config');
        expectUntouched(harness);
        expect(harness.map.fetches).toBe(0);
    });
});

describe('BackendVersion driving a reset', () => {
    it('resets exactly once for one changed version', async () => {
        const harness = setup();
        let now = 0;
        let answer = 'sha-1';
        const carrier = makeCarrier({
            probe: async () => answer,
            nowMs: () => now,
            onChange: () => harness.coordinator.reset(),
        });

        await carrier.ensureFresh();
        answer = 'sha-2';
        now += TTL_MS;
        await carrier.ensureFresh();
        expect(carrier.takeResetNotice()).toBe(true);

        now += TTL_MS;
        await carrier.ensureFresh();
        expect(carrier.takeResetNotice()).toBe(false);
        now += TTL_MS;
        await carrier.ensureFresh();
        expect(carrier.takeResetNotice()).toBe(false);
        expect(harness.map.fetches).toBe(1);
        expect(harness.appConfig.fetches).toBe(1);
    });

    it('collapses concurrent calls into a single reset announced once', async () => {
        const harness = setup();
        let now = 0;
        let answer = 'sha-1';
        let probes = 0;
        const carrier = makeCarrier({
            probe: async () => {
                probes += 1;
                return answer;
            },
            nowMs: () => now,
            onChange: () => harness.coordinator.reset(),
        });

        await carrier.ensureFresh();
        answer = 'sha-2';
        now += TTL_MS;
        probes = 0;

        const oneCall = async (): Promise<boolean> => {
            await carrier.ensureFresh();
            return carrier.takeResetNotice();
        };
        const results = await Promise.all([oneCall(), oneCall(), oneCall(), oneCall(), oneCall()]);

        expect(probes).toBe(1);
        expect(harness.map.fetches).toBe(1);
        expect(harness.appConfig.fetches).toBe(1);
        expect(results.filter((reset) => reset)).toHaveLength(1);
    });

    it('throws without recording the version when the reset fails, and retries on the next call', async () => {
        const harness = setup();
        let now = 0;
        let answer = 'sha-1';
        const carrier = makeCarrier({
            probe: async () => answer,
            nowMs: () => now,
            onChange: () => harness.coordinator.reset(),
        });

        await carrier.ensureFresh();
        answer = 'sha-2';
        now += TTL_MS;
        harness.map.failWith = 'map request returned 502';

        await expect(carrier.ensureFresh()).rejects.toThrow('map request returned 502');
        expectUntouched(harness);

        harness.map.failWith = null;
        await carrier.ensureFresh();
        expect(carrier.takeResetNotice()).toBe(true);
        expect(harness.store.getSyncVersion()).toBe(3);

        now += TTL_MS;
        await carrier.ensureFresh();
        expect(carrier.takeResetNotice()).toBe(false);
        expect(harness.map.fetches).toBe(2);
    });
});
