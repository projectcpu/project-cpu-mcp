import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../logger/noop.logger.js';
import { PACKAGE_VERSION_TTL_MS } from '../constants.js';
import { createPackageVersionGate, PackageVersion } from '../package-version.js';
import { PackageVersionSignal } from '../types.js';

interface Harness {
    version: PackageVersion;
    fetchCount: () => number;
    setLatest: (latest: string | null) => void;
    failNext: () => void;
    advance: (ms: number) => void;
}

function harness(currentVersion: string, latest: string | null): Harness {
    let publishedLatest = latest;
    let fetchCount = 0;
    let failing = false;
    let now = 1_000_000;

    const version = new PackageVersion({
        currentVersion,
        fetchLatest: async () => {
            fetchCount += 1;
            if (failing) {
                failing = false;
                throw new Error('registry unreachable');
            }
            return publishedLatest;
        },
        nowMs: () => now,
        ttlMs: PACKAGE_VERSION_TTL_MS,
        logger: new NoopLogger(),
    });

    return {
        version,
        fetchCount: () => fetchCount,
        setLatest: (value) => {
            publishedLatest = value;
        },
        failNext: () => {
            failing = true;
        },
        advance: (ms) => {
            now += ms;
        },
    };
}

describe('package version rule', () => {
    const cases: Array<{ current: string; latest: string; signal: PackageVersionSignal }> = [
        { current: '0.7.0', latest: '0.7.1', signal: PackageVersionSignal.UpdateAvailable },
        { current: '0.7.0', latest: '0.8.0', signal: PackageVersionSignal.Blocked },
        { current: '0.8.0', latest: '0.7.0', signal: PackageVersionSignal.Silent },
        { current: '0.7.0', latest: '0.7.0', signal: PackageVersionSignal.Silent },
        { current: '0.8.0-rc.1', latest: '0.7.0', signal: PackageVersionSignal.Silent },
        { current: '0.7.0', latest: '0.7.0-rc.1', signal: PackageVersionSignal.Silent },
        { current: '0.7.0', latest: '0.8.0-rc.1', signal: PackageVersionSignal.Silent },
        { current: '0.7.0', latest: '0.7.1-rc.1', signal: PackageVersionSignal.Silent },
        { current: '0.7.0-rc.1', latest: '0.7.0', signal: PackageVersionSignal.UpdateAvailable },
        { current: '0.7.0', latest: '1.0.0', signal: PackageVersionSignal.Blocked },
        { current: '1.2.3', latest: '1.3.0', signal: PackageVersionSignal.UpdateAvailable },
        { current: '1.2.3', latest: '2.0.0', signal: PackageVersionSignal.Blocked },
        { current: '2.0.0', latest: '1.9.9', signal: PackageVersionSignal.Silent },
        { current: '0.7.0', latest: 'not-a-version', signal: PackageVersionSignal.Silent },
    ];

    it.each(cases)('current $current vs latest $latest → $signal', async ({ current, latest, signal }) => {
        const status = await harness(current, latest).version.check();

        expect(status.signal).toBe(signal);
        if (signal !== PackageVersionSignal.Silent) {
            expect(status.latest).toBe(latest);
        }
    });

    it('stays silent when the registry cannot be reached', async () => {
        const h = harness('0.7.0', '0.8.0');
        h.failNext();

        expect((await h.version.check()).signal).toBe(PackageVersionSignal.Silent);
    });
});

describe('package version gate', () => {
    it('throws an instruction to restart on a breaking release', async () => {
        const gate = createPackageVersionGate(harness('0.7.0', '0.8.0').version);

        await expect(gate.check()).rejects.toThrow(/0\.8\.0.*0\.7\.0.*restart/s);
    });

    it('reports a compatible release once per published version', async () => {
        const h = harness('0.7.0', '0.7.1');
        const gate = createPackageVersionGate(h.version);

        const first = await gate.check();
        h.advance(PACKAGE_VERSION_TTL_MS);
        const second = await gate.check();

        expect(first).toHaveLength(1);
        expect(first[0]).toMatch(/0\.7\.1/);
        expect(second).toEqual([]);
    });

    it('reports again when a newer compatible version appears', async () => {
        const h = harness('0.7.0', '0.7.1');
        const gate = createPackageVersionGate(h.version);

        await gate.check();
        h.setLatest('0.7.2');
        h.advance(PACKAGE_VERSION_TTL_MS);
        const second = await gate.check();

        expect(second).toHaveLength(1);
        expect(second[0]).toMatch(/0\.7\.2/);
    });

    it('says nothing while the registry is level with this build', async () => {
        const gate = createPackageVersionGate(harness('0.7.0', '0.7.0').version);

        expect(await gate.check()).toEqual([]);
    });
});

describe('package version ttl', () => {
    it('asks the registry once per window regardless of call count', async () => {
        const h = harness('0.7.0', '0.7.0');

        await h.version.check();
        await h.version.check();
        await h.version.check();
        await h.version.check();
        await h.version.check();

        expect(h.fetchCount()).toBe(1);
    });

    it('asks again once the window has elapsed', async () => {
        const h = harness('0.7.0', '0.7.0');

        await h.version.check();
        h.advance(PACKAGE_VERSION_TTL_MS - 1);
        await h.version.check();
        h.advance(1);
        await h.version.check();

        expect(h.fetchCount()).toBe(2);
    });

    it('counts a failed attempt against the window', async () => {
        const h = harness('0.7.0', '0.7.0');
        h.failNext();

        await h.version.check();
        await h.version.check();

        expect(h.fetchCount()).toBe(1);
    });

    it('stops asking the registry once blocked', async () => {
        const h = harness('0.7.0', '0.8.0');

        expect((await h.version.check()).signal).toBe(PackageVersionSignal.Blocked);
        h.advance(PACKAGE_VERSION_TTL_MS * 10);
        expect((await h.version.check()).signal).toBe(PackageVersionSignal.Blocked);
        h.advance(PACKAGE_VERSION_TTL_MS * 10);
        expect((await h.version.check()).signal).toBe(PackageVersionSignal.Blocked);

        expect(h.fetchCount()).toBe(1);
    });
});
