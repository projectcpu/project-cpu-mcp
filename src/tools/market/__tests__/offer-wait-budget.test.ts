import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NoopLogger } from '../../../logger/noop.logger.js';
import { MarketApiClient } from '../../../services/market/client.js';
import { MARKET_RETRY_BUDGET_MS } from '../../../services/market/constants.js';
import { MarketError } from '../../../services/market/error.js';
import { MarketOfferService } from '../../../services/market/offer.service.js';
import { MarketProfileClient } from '../../../services/market/profile.client.js';
import { MarketRecoveryStore } from '../../../services/market/recovery.store.js';
import { MarketSingleFlight } from '../../../services/market/single-flight.js';
import type { AppContext } from '../../../types.js';
import type { ToolHandler, ToolRegistrar } from '../../types.js';
import {
    FakeAppConfig,
    FakeBuyerWallet,
    makeOfferArgs,
    MarketRoute,
    NOW_SECONDS,
    offersPageWire,
    preparedWire,
    reply,
    RoutedMarketTransport,
    settle,
} from '../make-offer/__tests__/fixtures.js';
import { registerMakeCellOfferTool } from '../register.js';

function makeOfferHandler(transport: RoutedMarketTransport): ToolHandler {
    const logger = new NoopLogger();
    const client = new MarketApiClient({ api: transport, logger });
    const service = new MarketOfferService({
        client,
        profile: new MarketProfileClient({ client, logger }),
        appConfig: new FakeAppConfig(),
        wallet: new FakeBuyerWallet(),
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

    registerMakeCellOfferTool(server, { logger, marketOffer: service } as unknown as AppContext);

    const handler = captured as ToolHandler | null;
    if (handler === null) {
        throw new Error('the tool was not registered');
    }
    return handler;
}

describe('the automatic wait budget of one offer tool invocation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('covers the wait for the read snapshot to advance, which opens no budget of its own', async () => {
        const transport = new RoutedMarketTransport({
            [MarketRoute.MyOffers]: [
                reply(429, { code: 'upstreamRateLimited', message: 'slow down' }, { 'retry-after': '27' }),
                reply(429, { code: 'upstreamRateLimited', message: 'slow down' }, { 'retry-after': '27' }),
                reply(200, offersPageWire([], null)),
            ],
            [MarketRoute.Prepare]: [reply(200, preparedWire())],
            [MarketRoute.Submit]: [reply(429, { code: 'upstreamRateLimited', message: 'slow down' })],
        });
        const handler = makeOfferHandler(transport);
        const startedAt = Date.now();

        const outcome = await settle(Promise.resolve(handler(makeOfferArgs())));

        expect(outcome).toBeInstanceOf(MarketError);
        expect(transport.callsOn(MarketRoute.Submit).length).toBeGreaterThan(1);
        expect(Date.now() - startedAt).toBeLessThanOrEqual(MARKET_RETRY_BUDGET_MS);
    });

    it('honours no wait that would carry the call past the deadline of the offer it prepared', async () => {
        const transport = new RoutedMarketTransport({
            [MarketRoute.MyOffers]: [reply(200, offersPageWire([], null))],
            [MarketRoute.Prepare]: [reply(200, preparedWire({ expiresAt: NOW_SECONDS + 3 }))],
            [MarketRoute.Submit]: [reply(503, { code: 'x', message: 'down' })],
        });
        const handler = makeOfferHandler(transport);
        const startedAt = Date.now();

        const outcome = await settle(Promise.resolve(handler(makeOfferArgs())));

        expect(outcome).toBeInstanceOf(MarketError);
        expect(Date.now() - startedAt).toBeLessThanOrEqual(3_000);
    });
});
