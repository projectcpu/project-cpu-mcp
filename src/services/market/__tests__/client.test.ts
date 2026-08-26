import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { FakeMarketTransport, reply } from './fixtures.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { MarketApiClient } from '../client.js';
import { MARKET_RETRY_BUDGET_MS } from '../constants.js';
import { MarketError } from '../error.js';
import { MarketActionStage, MarketErrorCode, type MarketRequestInput } from '../types.js';

const okSchema = z.object({ ok: z.literal(true) });

function request(): MarketRequestInput<typeof okSchema> {
    return {
        path: '/api/v1/market/probe',
        method: 'GET',
        body: null,
        schema: okSchema,
        stage: MarketActionStage.Read,
        label: 'probe the market',
    };
}

function clientOver(transport: FakeMarketTransport): MarketApiClient {
    return new MarketApiClient({ api: transport, logger: new NoopLogger() });
}

async function settle<T>(promise: Promise<T>): Promise<unknown> {
    const outcome = promise.then(
        (value) => ({ done: true, value }),
        (error: unknown) => ({ done: true, value: error }),
    );
    let done = false;
    void outcome.then(() => {
        done = true;
    });
    for (let step = 0; step < 200 && !done; step += 1) {
        await vi.advanceTimersToNextTimerAsync();
    }
    return (await outcome).value;
}

describe('MarketApiClient', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns schema-validated data from a successful authenticated call', async () => {
        const transport = new FakeMarketTransport([reply(200, { ok: true })]);

        await expect(clientOver(transport).send(request())).resolves.toEqual({ ok: true });
        expect(transport.calls).toEqual([{ path: '/api/v1/market/probe', method: 'GET', body: null }]);
    });

    it('rejects wire data that does not match the declared schema instead of passing it through', async () => {
        const transport = new FakeMarketTransport([reply(200, { ok: 'yes' })]);

        const error = await clientOver(transport)
            .send(request())
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(MarketError);
        expect((error as MarketError).code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect((error as MarketError).retryable).toBe(false);
    });

    it('waits the structured rate limit out and succeeds on the retry, spending the delay from Retry-After', async () => {
        vi.useFakeTimers();
        const transport = new FakeMarketTransport([
            reply(429, { code: 'upstreamRateLimited', message: 'slow down' }, { 'retry-after': '5' }),
            reply(200, { ok: true }),
        ]);
        const startedAt = Date.now();

        const outcome = await settle(clientOver(transport).send(request()));

        expect(outcome).toEqual({ ok: true });
        expect(Date.now() - startedAt).toBe(5_000);
        expect(transport.calls).toHaveLength(2);
    });

    it('turns a bare non-JSON 429 into a clear retryable rate-limit error rather than a parse failure', async () => {
        vi.useFakeTimers();
        const transport = new FakeMarketTransport(
            [reply(429, null, { 'retry-after': '3600' })],
            reply(429, null, { 'retry-after': '3600' }),
        );

        const error = (await settle(clientOver(transport).send(request()))) as MarketError;

        expect(error).toBeInstanceOf(MarketError);
        expect(error.code).toBe(MarketErrorCode.UpstreamRateLimited);
        expect(error.retryable).toBe(true);
        expect(error.retryAfterSeconds).toBe(3600);
        expect(error.message).toMatch(/retryAfterSeconds=3600/);
        expect(error.message).not.toMatch(/JSON/i);
    });

    it('returns immediately when Retry-After is longer than the remaining automatic-wait budget', async () => {
        vi.useFakeTimers();
        const transport = new FakeMarketTransport([
            reply(429, { code: 'upstreamRateLimited', message: 'slow down' }, { 'retry-after': '600' }),
        ]);
        const startedAt = Date.now();

        const error = (await settle(clientOver(transport).send(request()))) as MarketError;

        expect(Date.now() - startedAt).toBe(0);
        expect(error.retryAfterSeconds).toBe(600);
        expect(transport.calls).toHaveLength(1);
    });

    it('reads Retry-After off the response headers, since the structured 429 body carries no numeric delay', async () => {
        vi.useFakeTimers();
        const body = { code: 'upstreamRateLimited', message: 'slow down' };
        const transport = new FakeMarketTransport([reply(429, body, { 'retry-after': '900' })]);

        const error = (await settle(clientOver(transport).send(request()))) as MarketError;

        expect(error.retryAfterSeconds).toBe(900);
        expect(Object.keys(body)).toEqual(['code', 'message']);
    });

    it('retries a 5xx with bounded backoff and succeeds once the service recovers', async () => {
        vi.useFakeTimers();
        const transport = new FakeMarketTransport([
            reply(503, { code: 'x', message: 'down' }),
            reply(200, { ok: true }),
        ]);

        const outcome = await settle(clientOver(transport).send(request()));

        expect(outcome).toEqual({ ok: true });
        expect(transport.calls).toHaveLength(2);
    });

    it('retries a short network failure inside the same call', async () => {
        vi.useFakeTimers();
        const transport = new FakeMarketTransport([new Error('fetch failed'), reply(200, { ok: true })]);

        const outcome = await settle(clientOver(transport).send(request()));

        expect(outcome).toEqual({ ok: true });
        expect(transport.calls).toHaveLength(2);
    });

    it('never spends more than the cumulative 60-second budget across a run of failures', async () => {
        vi.useFakeTimers();
        const transport = new FakeMarketTransport([], reply(503, { code: 'x', message: 'down' }));
        const startedAt = Date.now();

        const error = (await settle(clientOver(transport).send(request()))) as MarketError;

        expect(error).toBeInstanceOf(MarketError);
        expect(error.code).toBe(MarketErrorCode.ServiceUnavailable);
        expect(error.retryable).toBe(true);
        expect(Date.now() - startedAt).toBeLessThanOrEqual(MARKET_RETRY_BUDGET_MS);
        expect(transport.calls.length).toBeGreaterThan(1);
    });

    it('does not let a run of rate limits reset or extend the one budget', async () => {
        vi.useFakeTimers();
        const rateLimited = reply(429, { code: 'upstreamRateLimited', message: 'slow down' }, { 'retry-after': '20' });
        const transport = new FakeMarketTransport([], rateLimited);
        const startedAt = Date.now();

        const error = (await settle(clientOver(transport).send(request()))) as MarketError;

        expect(error.code).toBe(MarketErrorCode.UpstreamRateLimited);
        expect(Date.now() - startedAt).toBeLessThanOrEqual(MARKET_RETRY_BUDGET_MS);
    });

    it('reports a 401 that survived the transport reauthentication as terminal', async () => {
        const transport = new FakeMarketTransport([reply(401, { code: 'unauthorized', message: 'no' })]);

        const error = await clientOver(transport)
            .send(request())
            .catch((e: unknown) => e);

        expect((error as MarketError).code).toBe(MarketErrorCode.Unauthorized);
        expect((error as MarketError).retryable).toBe(false);
        expect(transport.calls).toHaveLength(1);
    });

    it('carries the stable code and stage of a structured terminal market failure', async () => {
        const transport = new FakeMarketTransport([
            reply(409, { code: 'preparedIntentFlowMismatch', message: 'wrong flow' }),
        ]);

        const error = (await clientOver(transport)
            .send({ ...request(), stage: MarketActionStage.Submit })
            .catch((e: unknown) => e)) as MarketError;

        expect(error.code).toBe(MarketErrorCode.PreparedIntentFlowMismatch);
        expect(error.retryable).toBe(false);
        expect(error.stage).toBe(MarketActionStage.Submit);
        expect(error.message).toMatch(/preparedIntentFlowMismatch/);
        expect(error.message).toMatch(/"submit"/);
    });

    it('marks a structured retryable market code as safe to repeat', async () => {
        const transport = new FakeMarketTransport([
            reply(409, { code: 'preparedIntentInProgress', message: 'in flight' }),
        ]);

        const error = (await clientOver(transport)
            .send(request())
            .catch((e: unknown) => e)) as MarketError;

        expect(error.code).toBe(MarketErrorCode.PreparedIntentInProgress);
        expect(error.retryable).toBe(true);
        expect(error.message).toMatch(/safe/i);
    });
});
