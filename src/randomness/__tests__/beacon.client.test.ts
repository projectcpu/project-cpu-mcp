import { isHex, size } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RandomnessKind, drandRandomnessSchema, type DrandRandomnessDescriptor } from '../../api/types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { BeaconClient } from '../beacon.client.js';
import { isBeaconRetryable } from '../beacon.utils.js';
import { BEACON_RETRY_INTERVAL_MS } from '../constants.js';
import { BeaconRoundOutcome, type BeaconRoundResult } from '../types.js';

const BEACON_API = 'https://beacon.example/v2/chains/abc';
const ROUND = 4_211n;
const SIGNATURE = 'ab'.repeat(64);

const mockFetch = vi.fn();

function descriptor(beaconApi: string = BEACON_API): DrandRandomnessDescriptor {
    return drandRandomnessSchema.parse({
        kind: RandomnessKind.DRAND,
        adapter: '0x00000000000000000000000000000000000000a2',
        genesis: 1_700_000_000,
        period: 3,
        beaconApi,
    });
}

function makeClient(beaconApi: string = BEACON_API): BeaconClient {
    return new BeaconClient({ baseUrl: descriptor(beaconApi).beaconApi, logger: new NoopLogger() });
}

function answers(body: unknown, status: number = 200): void {
    mockFetch.mockResolvedValueOnce(new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
}

async function ask(beaconApi: string = BEACON_API): Promise<BeaconRoundResult> {
    return makeClient(beaconApi).signatureOf(ROUND);
}

function expectAskedFor(url: string): void {
    expect(mockFetch).toHaveBeenCalledWith(url, expect.objectContaining({ signal: expect.any(AbortSignal) }));
}

describe('BeaconClient', () => {
    beforeEach(() => {
        mockFetch.mockReset();
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        vi.unstubAllEnvs();
    });

    it('asks the beacon for the round under the base the descriptor carries', async () => {
        answers({ round: Number(ROUND), signature: SIGNATURE });

        await ask();

        expectAskedFor(`${BEACON_API}/public/${ROUND}`);
    });

    it('keeps the path of a base that has one and does not double its trailing slash', async () => {
        answers({ round: Number(ROUND), signature: SIGNATURE });

        await ask(`${BEACON_API}/`);

        expectAskedFor(`${BEACON_API}/public/${ROUND}`);
    });

    it('takes the base only from the descriptor, with no environment variable able to redirect it', async () => {
        vi.stubEnv('BEACON_API', 'https://elsewhere.example');
        vi.stubEnv('BEACON_URL', 'https://elsewhere.example');
        vi.stubEnv('DRAND_API', 'https://elsewhere.example');
        vi.stubEnv('RANDOMNESS_BEACON_URL', 'https://elsewhere.example');
        answers({ round: Number(ROUND), signature: SIGNATURE });

        await ask();

        expectAskedFor(`${BEACON_API}/public/${ROUND}`);
    });

    it('reports the round as signed when the round matches and the signature has the shape the contract takes', async () => {
        answers({ round: Number(ROUND), signature: SIGNATURE });

        const result = await ask();

        expect(result.outcome).toBe(BeaconRoundOutcome.SIGNED);
        expect(result).toEqual({ outcome: BeaconRoundOutcome.SIGNED, round: ROUND, signature: `0x${SIGNATURE}` });
    });

    it('prefixes the unprefixed signature into 64 bytes of hex', async () => {
        answers({ round: Number(ROUND), signature: SIGNATURE });

        const result = await ask();

        if (result.outcome !== BeaconRoundOutcome.SIGNED) throw new Error(result.reason);
        expect(isHex(result.signature)).toBe(true);
        expect(size(result.signature)).toBe(64);
    });

    it('takes a signature that already carries the prefix without doubling it', async () => {
        answers({ round: Number(ROUND), signature: `0x${SIGNATURE}` });

        const result = await ask();

        if (result.outcome !== BeaconRoundOutcome.SIGNED) throw new Error(result.reason);
        expect(result.signature).toBe(`0x${SIGNATURE}`);
        expect(size(result.signature)).toBe(64);
    });

    it('ignores the fields a beacon answer carries beyond the round and its signature', async () => {
        answers({ round: Number(ROUND), signature: SIGNATURE, randomness: 'ff'.repeat(32) });

        const result = await ask();

        expect(result).toEqual({ outcome: BeaconRoundOutcome.SIGNED, round: ROUND, signature: `0x${SIGNATURE}` });
    });

    it('reads a missing round as not released yet', async () => {
        answers({ error: 'round not published yet' }, 404);

        const result = await ask();

        expect(result.outcome).toBe(BeaconRoundOutcome.NOT_RELEASED);
        expect(isBeaconRetryable(result)).toBe(true);
    });

    it('reads a beacon that cannot be reached as not released yet', async () => {
        mockFetch.mockRejectedValueOnce(new Error('connect ECONNREFUSED'));

        const result = await ask();

        expect(result.outcome).toBe(BeaconRoundOutcome.NOT_RELEASED);
        expect(isBeaconRetryable(result)).toBe(true);
    });

    it('reads a beacon failing on its own side as not released yet', async () => {
        answers({ error: 'beacon failed' }, 503);

        const result = await ask();

        expect(result.outcome).toBe(BeaconRoundOutcome.NOT_RELEASED);
        expect(isBeaconRetryable(result)).toBe(true);
    });

    it('arms every request with a cutoff at the retry step instead of hanging on a silent beacon', async () => {
        const armed = vi.spyOn(AbortSignal, 'timeout');
        answers({ round: Number(ROUND), signature: SIGNATURE });

        await ask();

        expect(armed).toHaveBeenCalledWith(BEACON_RETRY_INTERVAL_MS);
        expect(mockFetch.mock.calls[0]?.[1]?.signal).toBe(armed.mock.results[0]?.value);
    });

    it('reads a beacon that takes the connection and then goes silent as not released yet', async () => {
        const cutoff = new AbortController();
        vi.spyOn(AbortSignal, 'timeout').mockReturnValue(cutoff.signal);
        mockFetch.mockImplementationOnce(
            (_url: string, init: RequestInit) =>
                new Promise((_resolve, reject) => {
                    const signal = init.signal as AbortSignal;
                    signal.addEventListener('abort', () => reject(signal.reason));
                }),
        );

        const pending = ask();
        expect(mockFetch.mock.calls[0]?.[1]?.signal).toBe(cutoff.signal);
        cutoff.abort(new DOMException('the operation timed out', 'TimeoutError'));
        const result = await pending;

        expect(result.outcome).toBe(BeaconRoundOutcome.NOT_RELEASED);
        expect(isBeaconRetryable(result)).toBe(true);
    });

    it('reads a stale round from a caching beacon as not released yet, not as garbage', async () => {
        answers({ round: Number(ROUND) - 1, signature: SIGNATURE });

        const result = await ask();

        expect(result.outcome).toBe(BeaconRoundOutcome.NOT_RELEASED);
        expect(result.outcome).not.toBe(BeaconRoundOutcome.MALFORMED);
        expect(isBeaconRetryable(result)).toBe(true);
    });

    it('reads a signature of the wrong length as garbage worth no retry', async () => {
        answers({ round: Number(ROUND), signature: SIGNATURE.slice(0, 96) });

        const result = await ask();

        expect(result.outcome).toBe(BeaconRoundOutcome.MALFORMED);
        expect(isBeaconRetryable(result)).toBe(false);
    });

    it('reads a signature that is the right length but not hex as garbage', async () => {
        answers({ round: Number(ROUND), signature: 'zz'.repeat(64) });

        const result = await ask();

        expect(result.outcome).toBe(BeaconRoundOutcome.MALFORMED);
    });

    it('reads an answer without a signature as not released yet rather than as garbage', async () => {
        answers({ round: Number(ROUND) });

        const result = await ask();

        expect(result.outcome).toBe(BeaconRoundOutcome.NOT_RELEASED);
        expect(isBeaconRetryable(result)).toBe(true);
    });

    it('reads a page served in front of a live beacon as not released yet rather than as garbage', async () => {
        answers('<html>not a beacon</html>');

        const result = await ask();

        expect(result.outcome).toBe(BeaconRoundOutcome.NOT_RELEASED);
        expect(isBeaconRetryable(result)).toBe(true);
    });

    it('reads an empty body as not released yet rather than as garbage', async () => {
        answers('');

        const result = await ask();

        expect(result.outcome).toBe(BeaconRoundOutcome.NOT_RELEASED);
        expect(isBeaconRetryable(result)).toBe(true);
    });

    it('separates garbage from an unreleased round so the caller can stop on one and keep going on the other', async () => {
        answers({ round: Number(ROUND), signature: SIGNATURE.slice(0, 96) });
        const garbage = await ask();
        answers({ error: 'round not published yet' }, 404);
        const pending = await ask();

        expect(garbage.outcome).not.toBe(pending.outcome);
        expect(isBeaconRetryable(garbage)).toBe(false);
        expect(isBeaconRetryable(pending)).toBe(true);
    });

    it('asks once per call and leaves repeating to the caller', async () => {
        answers({ error: 'round not published yet' }, 404);

        await ask();

        expect(mockFetch).toHaveBeenCalledTimes(1);
    });
});
