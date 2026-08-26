import { describe, expect, it } from 'vitest';

import {
    FakeMarketTransport,
    MAKER,
    marketProfileClientOver,
    offerWireFrom,
    OTHER_MAKER,
    pageWire,
    reply,
} from '../../../../services/market/__tests__/fixtures.js';
import { MARKET_MY_OFFERS_RECEIVED_PATH } from '../../../../services/market/constants.js';
import { MarketError } from '../../../../services/market/error.js';
import type { MarketOfferPage } from '../../../../services/market/profile.schemas.js';
import { MarketErrorCode, MarketOfferKind } from '../../../../services/market/types.js';
import { captureMarketTool } from '../../__tests__/fixtures.js';
import { createGetMyOffersReceivedTool } from '../my-offers-received.js';

const THIRD_MAKER = `0x${'3'.repeat(40)}`;

function handlerOver(transport: FakeMarketTransport): (args: never) => Promise<{ content: Array<{ text: string }> }> {
    return captureMarketTool(createGetMyOffersReceivedTool, { marketProfile: marketProfileClientOver(transport) })
        .handler;
}

function payload(result: { content: Array<{ text: string }> }): MarketOfferPage {
    return JSON.parse(result.content[1]?.text ?? 'null') as MarketOfferPage;
}

describe('cpu_get_my_offers_received', () => {
    it('registers under its public name and takes no wallet override', () => {
        const tool = captureMarketTool(createGetMyOffersReceivedTool, {
            marketProfile: marketProfileClientOver(new FakeMarketTransport([])),
        });

        expect(tool.name).toBe('cpu_get_my_offers_received');
        expect(Object.keys(tool.inputSchema)).toEqual(['cursor']);
    });

    it('reads the received-offers route, distinct from the offers the caller made', async () => {
        const transport = new FakeMarketTransport([reply(200, pageWire([], null))]);

        await handlerOver(transport)({ cursor: null } as never);

        expect(transport.calls[0]?.path).toBe(MARKET_MY_OFFERS_RECEIVED_PATH);
    });

    it('forwards a subsequent cursor to the same route', async () => {
        const transport = new FakeMarketTransport([reply(200, pageWire([], null))]);

        await handlerOver(transport)({ cursor: 'page-3' } as never);

        expect(transport.calls[0]?.path).toBe(`${MARKET_MY_OFFERS_RECEIVED_PATH}?cursor=page-3`);
    });

    it('keeps every offer whose maker is another wallet', async () => {
        const items = [
            offerWireFrom(MarketOfferKind.Item, '1234', OTHER_MAKER),
            offerWireFrom(MarketOfferKind.Collection, null, THIRD_MAKER),
            offerWireFrom(MarketOfferKind.Trait, null, MAKER),
        ];
        const transport = new FakeMarketTransport([reply(200, pageWire(items, null))]);

        const result = await handlerOver(transport)({ cursor: null } as never);

        expect(payload(result).items.map((offer) => offer.maker)).toEqual([OTHER_MAKER, THIRD_MAKER, MAKER]);
        expect(payload(result).items.map((offer) => offer.kind)).toEqual([
            MarketOfferKind.Item,
            MarketOfferKind.Collection,
            MarketOfferKind.Trait,
        ]);
    });

    it('returns a short page that still carries another cursor', async () => {
        const transport = new FakeMarketTransport([
            reply(200, pageWire([offerWireFrom(MarketOfferKind.Item, '1234', OTHER_MAKER)], 'page-4')),
        ]);

        const result = await handlerOver(transport)({ cursor: null } as never);

        expect(payload(result).items).toHaveLength(1);
        expect(payload(result).nextCursor).toBe('page-4');
    });

    it('reports a final empty page as no offers rather than an integration failure', async () => {
        const transport = new FakeMarketTransport([reply(200, pageWire([], null))]);

        const result = await handlerOver(transport)({ cursor: 'page-4' } as never);

        expect(payload(result)).toEqual({ items: [], nextCursor: null });
        expect(result.content[0]?.text).toMatch(/no offers/i);
    });

    it('surfaces a malformed order hash as a terminal market error', async () => {
        const transport = new FakeMarketTransport([
            reply(
                200,
                pageWire([{ ...offerWireFrom(MarketOfferKind.Item, '1234', OTHER_MAKER), orderHash: '0xdead' }], null),
            ),
        ]);

        const error = (await handlerOver(transport)({ cursor: null } as never).catch((e: unknown) => e)) as MarketError;

        expect(error).toBeInstanceOf(MarketError);
        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
    });
});
