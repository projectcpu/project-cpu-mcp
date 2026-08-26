import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NoopLogger } from '../../../logger/noop.logger.js';
import { MarketApiClient } from '../../../services/market/client.js';
import { MARKET_RETRY_BUDGET_MS } from '../../../services/market/constants.js';
import { MarketError } from '../../../services/market/error.js';
import { MarketListingService } from '../../../services/market/listing.service.js';
import { MarketProfileClient } from '../../../services/market/profile.client.js';
import { MarketRecoveryStore } from '../../../services/market/recovery.store.js';
import { MarketSingleFlight } from '../../../services/market/single-flight.js';
import type { AppContext } from '../../../types.js';
import type { ToolHandler, ToolRegistrar } from '../../types.js';
import {
    FakeAppConfig,
    FakeSellerWallet,
    listCellArgs,
    listingsPageWire,
    MarketRoute,
    NOW_SECONDS,
    preparedWire,
    reply,
    RoutedMarketTransport,
    settle,
} from '../list-cell/__tests__/fixtures.js';
import { registerListCellTool } from '../register.js';

function listCellHandler(transport: RoutedMarketTransport): ToolHandler {
    const logger = new NoopLogger();
    const client = new MarketApiClient({ api: transport, logger });
    const service = new MarketListingService({
        client,
        profile: new MarketProfileClient({ client, logger }),
        appConfig: new FakeAppConfig(),
        wallet: new FakeSellerWallet(),
        network: 'robinhood',
        singleFlight: new MarketSingleFlight(),
        recovery: new MarketRecoveryStore(),
        logger,
    });

    let captured: ToolHandler | null = null;
    const server = {
        registerTool(_name: string, _definition: unknown, handler: ToolHandler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    registerListCellTool(server, { logger, marketListing: service } as unknown as AppContext);

    if (captured === null) {
        throw new Error('the tool was not registered');
    }
    return captured;
}

describe('the automatic wait budget of one marketplace tool invocation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('is spent across every request the invocation makes, not renewed for each of them', async () => {
        const transport = new RoutedMarketTransport({
            [MarketRoute.MyListings]: [
                reply(429, { code: 'upstreamRateLimited', message: 'slow down' }, { 'retry-after': '25' }),
                reply(429, { code: 'upstreamRateLimited', message: 'slow down' }, { 'retry-after': '25' }),
                reply(200, listingsPageWire([], null)),
            ],
            [MarketRoute.Prepare]: [reply(503, { code: 'x', message: 'down' })],
        });
        const handler = listCellHandler(transport);
        const startedAt = Date.now();

        const outcome = await settle(Promise.resolve(handler(listCellArgs())));

        expect(outcome).toBeInstanceOf(MarketError);
        expect(Date.now() - startedAt).toBeLessThanOrEqual(MARKET_RETRY_BUDGET_MS);
        expect(transport.callsOn(MarketRoute.MyListings)).toHaveLength(3);
        expect(transport.callsOn(MarketRoute.Prepare).length).toBeGreaterThan(1);
    });

    it('covers the wait for the read snapshot to advance, which opens no budget of its own', async () => {
        const transport = new RoutedMarketTransport({
            [MarketRoute.MyListings]: [
                reply(429, { code: 'upstreamRateLimited', message: 'slow down' }, { 'retry-after': '27' }),
                reply(429, { code: 'upstreamRateLimited', message: 'slow down' }, { 'retry-after': '27' }),
                reply(200, listingsPageWire([], null)),
            ],
            [MarketRoute.Prepare]: [reply(200, preparedWire())],
            [MarketRoute.Submit]: [reply(429, { code: 'upstreamRateLimited', message: 'slow down' })],
        });
        const handler = listCellHandler(transport);
        const startedAt = Date.now();

        const outcome = await settle(Promise.resolve(handler(listCellArgs())));

        expect(outcome).toBeInstanceOf(MarketError);
        expect(transport.callsOn(MarketRoute.Submit).length).toBeGreaterThan(1);
        expect(Date.now() - startedAt).toBeLessThanOrEqual(MARKET_RETRY_BUDGET_MS);
    });

    it('cannot be reset or extended by a long run of failing responses', async () => {
        const transport = new RoutedMarketTransport({
            [MarketRoute.MyListings]: [
                reply(429, { code: 'upstreamRateLimited', message: 'slow down' }, { 'retry-after': '20' }),
                new Error('fetch failed'),
                reply(429, null, { 'retry-after': '20' }),
                reply(200, listingsPageWire([], null)),
            ],
            [MarketRoute.Prepare]: [reply(503, { code: 'x', message: 'down' })],
        });
        const handler = listCellHandler(transport);
        const startedAt = Date.now();

        const outcome = await settle(Promise.resolve(handler(listCellArgs())));

        expect(outcome).toBeInstanceOf(MarketError);
        expect(Date.now() - startedAt).toBeLessThanOrEqual(MARKET_RETRY_BUDGET_MS);
    });
});
