import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../logger/noop.logger.js';
import { BackendVersion, createBackendVersionProbe } from '../backend-version.js';
import { BACKEND_VERSION_TIMEOUT_MS } from '../constants.js';
import type { ProbeBackendVersion, VersionProbeApi } from '../types.js';

const TTL_MS = 60_000;

type ApiOutcome = { status: number; data: unknown } | { throws: string };

const SILENT_OUTCOMES: Array<[string, ApiOutcome]> = [
    ['404 — the endpoint does not exist', { status: 404, data: { message: 'Not Found' } }],
    ['429 — rate limited at the edge', { status: 429, data: { message: 'Too Many Requests' } }],
    ['5xx', { status: 502, data: { message: 'Bad Gateway' } }],
    ['a throw while reading the body', { throws: 'non-JSON response body' }],
    ['200 with an empty versionSha', { status: 200, data: { versionSha: '' } }],
    ['200 with a body that has no versionSha', { status: 200, data: { build: 'abc' } }],
];

class FakeApi implements VersionProbeApi {
    public readonly paths: Array<string> = [];
    public readonly timeouts: Array<number> = [];

    constructor(private outcome: ApiOutcome) {}

    setOutcome(outcome: ApiOutcome): void {
        this.outcome = outcome;
    }

    async requestWithTimeout<T>(path: string, timeoutMs: number): Promise<{ status: number; data: T }> {
        this.paths.push(path);
        this.timeouts.push(timeoutMs);
        if ('throws' in this.outcome) {
            throw new Error(this.outcome.throws);
        }
        return { status: this.outcome.status, data: this.outcome.data as T };
    }
}

function makeClock(): { nowMs: () => number; advance: (ms: number) => void } {
    let now = 1_000_000;
    return { nowMs: () => now, advance: (ms: number) => void (now += ms) };
}

function makeCarrier(options: {
    probe: ProbeBackendVersion;
    nowMs: () => number;
    onChange: (() => Promise<void>) | null;
}): BackendVersion {
    return new BackendVersion({
        probe: options.probe,
        nowMs: options.nowMs,
        ttlMs: TTL_MS,
        onChange: options.onChange ?? (async (): Promise<void> => undefined),
        logger: new NoopLogger(),
    });
}

describe('backend version probe', () => {
    it('reads the version off a 200 with a valid body', async () => {
        const api = new FakeApi({ status: 200, data: { versionSha: 'abc123def456' } });

        expect(await createBackendVersionProbe(api)()).toBe('abc123def456');
        expect(api.paths).toEqual(['/api/version']);
    });

    it('ignores extra fields but keeps the version', async () => {
        const api = new FakeApi({ status: 200, data: { versionSha: 'abc', builtAt: 42 } });

        expect(await createBackendVersionProbe(api)()).toBe('abc');
    });

    it('gives the request a deadline so a stalled endpoint cannot hold a tool call', async () => {
        const api = new FakeApi({ status: 200, data: { versionSha: 'abc' } });

        await createBackendVersionProbe(api)();

        expect(api.timeouts).toEqual([BACKEND_VERSION_TIMEOUT_MS]);
    });

    it('answers nothing when the request is cut off at the deadline', async () => {
        const api = new FakeApi({ throws: 'Cannot reach the game API — TimeoutError: signal timed out' });

        expect(await createBackendVersionProbe(api)()).toBeNull();
    });

    it.each(SILENT_OUTCOMES)('returns nothing on %s', async (_label, outcome) => {
        const api = new FakeApi(outcome);

        expect(await createBackendVersionProbe(api)()).toBeNull();
    });
});

describe('BackendVersion', () => {
    it('records the first observed version without resetting anything', async () => {
        let resets = 0;
        const clock = makeClock();
        const carrier = makeCarrier({
            probe: async () => 'sha-1',
            nowMs: clock.nowMs,
            onChange: async () => void (resets += 1),
        });

        await carrier.ensureFresh();
        expect(carrier.takeResetNotice()).toBe(false);
        expect(resets).toBe(0);
    });

    it('probes once per TTL window however often it is asked', async () => {
        let probes = 0;
        const clock = makeClock();
        const carrier = makeCarrier({
            probe: async () => {
                probes += 1;
                return 'sha-1';
            },
            nowMs: clock.nowMs,
            onChange: null,
        });

        await carrier.ensureFresh();
        clock.advance(TTL_MS - 1);
        await carrier.ensureFresh();
        await carrier.ensureFresh();
        await carrier.ensureFresh();
        await carrier.ensureFresh();

        expect(probes).toBe(1);
    });

    it('probes again once the TTL has elapsed', async () => {
        let probes = 0;
        const clock = makeClock();
        const carrier = makeCarrier({
            probe: async () => {
                probes += 1;
                return 'sha-1';
            },
            nowMs: clock.nowMs,
            onChange: null,
        });

        await carrier.ensureFresh();
        clock.advance(TTL_MS);
        await carrier.ensureFresh();

        expect(probes).toBe(2);
    });

    it('counts the TTL from the attempt, so a failed probe also holds the window', async () => {
        let probes = 0;
        const clock = makeClock();
        const carrier = makeCarrier({
            probe: async () => {
                probes += 1;
                return null;
            },
            nowMs: clock.nowMs,
            onChange: null,
        });

        await carrier.ensureFresh();
        clock.advance(TTL_MS - 1);
        await carrier.ensureFresh();

        expect(probes).toBe(1);
    });

    it('leaves the recorded version alone when a later probe answers nothing', async () => {
        let resets = 0;
        let answer: string | null = 'sha-1';
        const clock = makeClock();
        const carrier = makeCarrier({
            probe: async () => answer,
            nowMs: clock.nowMs,
            onChange: async () => void (resets += 1),
        });

        await carrier.ensureFresh();
        answer = null;
        clock.advance(TTL_MS);
        await carrier.ensureFresh();
        expect(carrier.takeResetNotice()).toBe(false);

        answer = 'sha-1';
        clock.advance(TTL_MS);
        await carrier.ensureFresh();
        expect(carrier.takeResetNotice()).toBe(false);
        expect(resets).toBe(0);
    });

    it.each([
        ['unknown', 'sha-2'],
        ['sha-1', 'unknown'],
    ])('treats %s → %s as an ordinary change', async (first, second) => {
        let resets = 0;
        let answer = first;
        const clock = makeClock();
        const carrier = makeCarrier({
            probe: async () => answer,
            nowMs: clock.nowMs,
            onChange: async () => void (resets += 1),
        });

        await carrier.ensureFresh();
        answer = second;
        clock.advance(TTL_MS);

        await carrier.ensureFresh();
        expect(carrier.takeResetNotice()).toBe(true);
        expect(resets).toBe(1);
    });

    it('never resets on an ignored outcome, whatever the response was', async () => {
        const clock = makeClock();
        const api = new FakeApi({ status: 200, data: { versionSha: 'sha-1' } });
        let resets = 0;
        const carrier = makeCarrier({
            probe: createBackendVersionProbe(api),
            nowMs: clock.nowMs,
            onChange: async () => void (resets += 1),
        });

        await carrier.ensureFresh();

        for (const [, outcome] of SILENT_OUTCOMES) {
            api.setOutcome(outcome);
            clock.advance(TTL_MS);
            await carrier.ensureFresh();
            expect(carrier.takeResetNotice()).toBe(false);
        }

        expect(resets).toBe(0);
    });
});
