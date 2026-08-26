import { describe, expect, it } from 'vitest';

import {
    FakeMarketTransport,
    MAKER,
    marketProfileClientOver,
    offerWireFrom,
    pageWire,
    reply,
} from '../../../../services/market/__tests__/fixtures.js';
import { MARKET_MY_OFFERS_PATH } from '../../../../services/market/constants.js';
import { MarketError } from '../../../../services/market/error.js';
import type { MarketOfferPage } from '../../../../services/market/profile.schemas.js';
import { MarketErrorCode, MarketOfferKind } from '../../../../services/market/types.js';
import { captureMarketTool } from '../../__tests__/fixtures.js';
import { createGetMyOffersTool } from '../my-offers.js';

function handlerOver(transport: FakeMarketTransport): (args: never) => Promise<{ content: Array<{ text: string }> }> {
    return captureMarketTool(createGetMyOffersTool, { marketProfile: marketProfileClientOver(transport) }).handler;
}

function payload(result: { content: Array<{ text: string }> }): MarketOfferPage {
    return JSON.parse(result.content[1]?.text ?? 'null') as MarketOfferPage;
}

describe('cpu_get_my_offers', () => {
    it('registers under its public name and takes no wallet override', () => {
        const tool = captureMarketTool(createGetMyOffersTool, {
            marketProfile: marketProfileClientOver(new FakeMarketTransport([])),
        });

        expect(tool.name).toBe('cpu_get_my_offers');
        expect(Object.keys(tool.inputSchema)).toEqual(['cursor']);
    });

    it('reads the caller-scoped offers route on the first page', async () => {
        const transport = new FakeMarketTransport([reply(200, pageWire([], null))]);

        await handlerOver(transport)({ cursor: null } as never);

        expect(transport.calls[0]?.path).toBe(MARKET_MY_OFFERS_PATH);
    });

    it('forwards a subsequent cursor to the same route', async () => {
        const transport = new FakeMarketTransport([reply(200, pageWire([], null))]);

        await handlerOver(transport)({ cursor: 'page-7' } as never);

        expect(transport.calls[0]?.path).toBe(`${MARKET_MY_OFFERS_PATH}?cursor=page-7`);
    });

    it('returns item, trait and collection offers the caller made, criteria offers included', async () => {
        const items = [
            offerWireFrom(MarketOfferKind.Item, '1234', MAKER),
            offerWireFrom(MarketOfferKind.Trait, null, MAKER),
            offerWireFrom(MarketOfferKind.Collection, null, MAKER),
        ];
        const transport = new FakeMarketTransport([reply(200, pageWire(items, null))]);

        const result = await handlerOver(transport)({ cursor: null } as never);

        expect(payload(result).items.map((offer) => offer.kind)).toEqual([
            MarketOfferKind.Item,
            MarketOfferKind.Trait,
            MarketOfferKind.Collection,
        ]);
        expect(payload(result).items.map((offer) => offer.tokenId)).toEqual(['1234', null, null]);
        expect(payload(result).items[0]).toEqual(items[0]);
    });

    it('returns a short page that still carries another cursor', async () => {
        const transport = new FakeMarketTransport([
            reply(200, pageWire([offerWireFrom(MarketOfferKind.Item, '1234', MAKER)], 'page-2')),
        ]);

        const result = await handlerOver(transport)({ cursor: null } as never);

        expect(payload(result).items).toHaveLength(1);
        expect(payload(result).nextCursor).toBe('page-2');
    });

    it('reports a final empty page as no offers rather than an integration failure', async () => {
        const transport = new FakeMarketTransport([reply(200, pageWire([], null))]);

        const result = await handlerOver(transport)({ cursor: 'page-9' } as never);

        expect(payload(result)).toEqual({ items: [], nextCursor: null });
        expect(result.content[0]?.text).toMatch(/no offers/i);
    });

    it('surfaces an unknown offer kind as a terminal market error', async () => {
        const transport = new FakeMarketTransport([
            reply(200, pageWire([{ ...offerWireFrom(MarketOfferKind.Item, '1234', MAKER), kind: 'bundle' }], null)),
        ]);

        const error = (await handlerOver(transport)({ cursor: null } as never).catch((e: unknown) => e)) as MarketError;

        expect(error).toBeInstanceOf(MarketError);
        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
    });
});
