import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import {
    backendOrderFrom,
    backendSnapshotWire,
    emptySnapshotWire,
    errorWire,
    FakeMarketTransport,
    marketServiceOver,
    offerWire,
    reply,
    snapshotWire,
} from '../../../../services/market/__tests__/fixtures.js';
import { MARKET_RETRY_BUDGET_MS } from '../../../../services/market/constants.js';
import { MarketError } from '../../../../services/market/error.js';
import { type CellMarketSnapshot, MarketErrorCode, MarketOfferKind } from '../../../../services/market/types.js';
import { captureMarketTool } from '../../__tests__/fixtures.js';
import { getCellMarketInputSchema } from '../../types.js';
import { createGetCellMarketTool } from '../cell-market.js';

function handlerOver(transport: FakeMarketTransport): (args: never) => Promise<{ content: Array<{ text: string }> }> {
    return captureMarketTool(createGetCellMarketTool, { market: marketServiceOver(transport) }).handler;
}

function payload(result: { content: Array<{ text: string }> }): CellMarketSnapshot {
    return JSON.parse(result.content[1]?.text ?? 'null') as CellMarketSnapshot;
}

async function settle<T>(promise: Promise<T>): Promise<unknown> {
    const outcome = promise.then(
        (value) => value as unknown,
        (error: unknown) => error,
    );
    let done = false;
    void outcome.then(() => {
        done = true;
    });
    for (let step = 0; step < 200 && !done; step += 1) {
        await vi.advanceTimersToNextTimerAsync();
    }
    return outcome;
}

describe('cpu_get_cell_market', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('registers under its public name', () => {
        const tool = captureMarketTool(createGetCellMarketTool, {
            market: marketServiceOver(new FakeMarketTransport([])),
        });
        expect(tool.name).toBe('cpu_get_cell_market');
    });

    it('accepts a canonical decimal Cell id and refuses one with leading zeroes', () => {
        const schema = z.object(getCellMarketInputSchema);

        expect(schema.safeParse({ tokenId: '1234' }).success).toBe(true);
        expect(schema.safeParse({ tokenId: '01234' }).success).toBe(false);
        expect(schema.safeParse({ tokenId: '' }).success).toBe(false);
        expect(schema.safeParse({ tokenId: '12.5' }).success).toBe(false);
    });

    it('returns the same Cell plus its best listing and best offer', async () => {
        const result = await handlerOver(new FakeMarketTransport([reply(200, backendSnapshotWire)]))({
            tokenId: '1234',
        } as never);

        expect(payload(result)).toEqual({
            tokenId: '1234',
            bestListing: snapshotWire.bestListing,
            bestOffer: snapshotWire.bestOffer,
        });
    });

    it('calls the tool with the arguments the schema produced, not a rewritten Cell id', async () => {
        const transport = new FakeMarketTransport([reply(200, backendSnapshotWire)]);
        await handlerOver(transport)({ tokenId: '1234' } as never);

        expect(transport.calls[0]?.path).toBe('/api/v1/market/cells/1234');
    });

    it('reports an empty snapshot as two nulls rather than an integration failure', async () => {
        const result = await handlerOver(new FakeMarketTransport([reply(200, emptySnapshotWire)]))({
            tokenId: '1234',
        } as never);

        expect(payload(result)).toEqual({ tokenId: '1234', bestListing: null, bestOffer: null });
        expect(result.content[0]?.text).toMatch(/best listing: none/);
        expect(result.content[0]?.text).toMatch(/best offer: none/);
    });

    it('preserves item, trait and collection offers, including a criteria offer with no bound Cell', async () => {
        for (const kind of Object.values(MarketOfferKind)) {
            const tokenId = kind === MarketOfferKind.Item ? '1234' : null;
            const transport = new FakeMarketTransport([
                reply(200, {
                    ...backendSnapshotWire,
                    bestOffer: { ...backendOrderFrom(offerWire(kind, tokenId)), kind },
                }),
            ]);

            const result = await handlerOver(transport)({ tokenId: '1234' } as never);

            expect(payload(result).bestOffer?.kind).toBe(kind);
            expect(payload(result).bestOffer?.tokenId).toBe(tokenId);
            expect(result.content[0]?.text).toMatch(new RegExp(`best offer \\[${kind}\\]`));
        }
    });

    it('surfaces invalid wire data as a terminal market error instead of a half-parsed snapshot', async () => {
        const transport = new FakeMarketTransport([
            reply(200, { ...backendSnapshotWire, bestOffer: { ...backendSnapshotWire.bestOffer, kind: 'bundle' } }),
        ]);

        const error = (await handlerOver(transport)({ tokenId: '1234' } as never).catch(
            (e: unknown) => e,
        )) as MarketError;

        expect(error).toBeInstanceOf(MarketError);
        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(error.retryable).toBe(false);
    });

    it('turns a structured 429 that cannot be waited out into a retryable error carrying the header delay', async () => {
        vi.useFakeTimers();
        const transport = new FakeMarketTransport(
            [],
            reply(429, errorWire('upstreamRateLimited', 'rate limited upstream'), { 'retry-after': '3600' }),
        );

        const error = (await settle(handlerOver(transport)({ tokenId: '1234' } as never))) as MarketError;

        expect(error.code).toBe(MarketErrorCode.UpstreamRateLimited);
        expect(error.retryable).toBe(true);
        expect(error.retryAfterSeconds).toBe(3600);
        expect(transport.calls).toHaveLength(1);
    });

    it('turns a bare non-JSON 429 into the same clear retryable error, not a JSON parse failure', async () => {
        vi.useFakeTimers();
        const transport = new FakeMarketTransport([], reply(429, null, { 'retry-after': '120' }));

        const error = (await settle(handlerOver(transport)({ tokenId: '1234' } as never))) as MarketError;

        expect(error).toBeInstanceOf(MarketError);
        expect(error.code).toBe(MarketErrorCode.UpstreamRateLimited);
        expect(error.retryAfterSeconds).toBe(120);
        expect(error.message).not.toMatch(/non-JSON|Unexpected token/i);
    });

    it('reports a 401 that survived reauthentication as terminal', async () => {
        const transport = new FakeMarketTransport([reply(401, errorWire('unauthorized', 'sign in'))]);

        const error = (await handlerOver(transport)({ tokenId: '1234' } as never).catch(
            (e: unknown) => e,
        )) as MarketError;

        expect(error.code).toBe(MarketErrorCode.Unauthorized);
        expect(error.retryable).toBe(false);
    });

    it('rides out a short 5xx inside one call', async () => {
        vi.useFakeTimers();
        const transport = new FakeMarketTransport([
            reply(502, errorWire('x', 'bad gateway')),
            reply(200, backendSnapshotWire),
        ]);

        const result = (await settle(handlerOver(transport)({ tokenId: '1234' } as never))) as {
            content: Array<{ text: string }>;
        };

        expect(payload(result).tokenId).toBe('1234');
        expect(transport.calls).toHaveLength(2);
    });

    it('gives up inside the one cumulative wait budget when the 5xx never clears', async () => {
        vi.useFakeTimers();
        const transport = new FakeMarketTransport([], reply(503, errorWire('x', 'down')));
        const startedAt = Date.now();

        const error = (await settle(handlerOver(transport)({ tokenId: '1234' } as never))) as MarketError;

        expect(error.code).toBe(MarketErrorCode.ServiceUnavailable);
        expect(error.retryable).toBe(true);
        expect(Date.now() - startedAt).toBeLessThanOrEqual(MARKET_RETRY_BUDGET_MS);
    });

    it('tells the agent that both sides are independently nullable and that map reads carry no market data', () => {
        const tool = captureMarketTool(createGetCellMarketTool, {
            market: marketServiceOver(new FakeMarketTransport([])),
        });

        expect(tool.description).toMatch(/independently nullable/i);
        expect(tool.description).toMatch(/base-unit/i);
        expect(tool.description).toMatch(/map and Cell reads carry no marketplace data/i);
    });
});
