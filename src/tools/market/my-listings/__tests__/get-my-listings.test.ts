import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
    backendListingPageWire,
    FakeMarketTransport,
    listingWireFor,
    marketProfileClientOver,
    reply,
} from '../../../../services/market/__tests__/fixtures.js';
import { MARKET_MY_LISTINGS_PATH } from '../../../../services/market/constants.js';
import { MarketError } from '../../../../services/market/error.js';
import type { MarketListingPage } from '../../../../services/market/profile.schemas.js';
import { MarketErrorCode } from '../../../../services/market/types.js';
import { captureMarketTool } from '../../__tests__/fixtures.js';
import { marketPageInputSchema } from '../../types.js';
import { createGetMyListingsTool } from '../my-listings.js';

function handlerOver(transport: FakeMarketTransport): (args: never) => Promise<{ content: Array<{ text: string }> }> {
    return captureMarketTool(createGetMyListingsTool, { marketProfile: marketProfileClientOver(transport) }).handler;
}

function payload(result: { content: Array<{ text: string }> }): MarketListingPage {
    return JSON.parse(result.content[1]?.text ?? 'null') as MarketListingPage;
}

const LISTING_A = listingWireFor('1234', `0x${'a'.repeat(64)}`);
const LISTING_B = listingWireFor('5678', `0x${'d'.repeat(64)}`);

describe('cpu_get_my_listings', () => {
    it('registers under its public name and takes no wallet override', () => {
        const tool = captureMarketTool(createGetMyListingsTool, {
            marketProfile: marketProfileClientOver(new FakeMarketTransport([])),
        });

        expect(tool.name).toBe('cpu_get_my_listings');
        expect(Object.keys(tool.inputSchema)).toEqual(['cursor']);
    });

    it('defaults the cursor to null and rejects an empty cursor string', () => {
        const schema = z.object(marketPageInputSchema);

        expect(schema.parse({})).toEqual({ cursor: null });
        expect(schema.safeParse({ cursor: 'page-2' }).success).toBe(true);
        expect(schema.safeParse({ cursor: '' }).success).toBe(false);
    });

    it('reads the caller-scoped listings route on the first page', async () => {
        const transport = new FakeMarketTransport([reply(200, backendListingPageWire([LISTING_A], null))]);

        await handlerOver(transport)({ cursor: null } as never);

        expect(transport.calls[0]?.path).toBe(MARKET_MY_LISTINGS_PATH);
    });

    it('forwards a subsequent cursor to the same route', async () => {
        const transport = new FakeMarketTransport([reply(200, backendListingPageWire([LISTING_B], null))]);

        await handlerOver(transport)({ cursor: 'page-2' } as never);

        expect(transport.calls[0]?.path).toBe(`${MARKET_MY_LISTINGS_PATH}?cursor=page-2`);
    });

    it('returns a short page that still carries another cursor', async () => {
        const transport = new FakeMarketTransport([reply(200, backendListingPageWire([LISTING_A], 'page-2'))]);

        const result = await handlerOver(transport)({ cursor: null } as never);

        expect(payload(result).items).toHaveLength(1);
        expect(payload(result).nextCursor).toBe('page-2');
        expect(result.content[0]?.text).toMatch(/page-2/);
    });

    it('reports a final page as a null next cursor', async () => {
        const transport = new FakeMarketTransport([reply(200, backendListingPageWire([LISTING_A, LISTING_B], null))]);

        const result = await handlerOver(transport)({ cursor: 'page-2' } as never);

        expect(payload(result).nextCursor).toBeNull();
        expect(payload(result).items.map((listing) => listing.tokenId)).toEqual(['1234', '5678']);
    });

    it('reports an empty page as no listings rather than an integration failure', async () => {
        const transport = new FakeMarketTransport([reply(200, backendListingPageWire([], null))]);

        const result = await handlerOver(transport)({ cursor: null } as never);

        expect(payload(result)).toEqual({ items: [], nextCursor: null });
        expect(result.content[0]?.text).toMatch(/no listings/i);
    });

    it('preserves base-unit prices, order hashes, protocol addresses and Unix-second times verbatim', async () => {
        const transport = new FakeMarketTransport([reply(200, backendListingPageWire([LISTING_A], null))]);

        const result = await handlerOver(transport)({ cursor: null } as never);

        expect(payload(result).items[0]).toEqual(LISTING_A);
    });

    it('surfaces an invalid page as a terminal market error', async () => {
        const transport = new FakeMarketTransport([reply(200, { listings: [LISTING_A] })]);

        const error = (await handlerOver(transport)({ cursor: null } as never).catch((e: unknown) => e)) as MarketError;

        expect(error).toBeInstanceOf(MarketError);
        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
    });
});
