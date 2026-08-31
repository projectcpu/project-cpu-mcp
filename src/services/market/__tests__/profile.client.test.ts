import { describe, expect, it } from 'vitest';

import {
    backendListingPageWire,
    backendOfferPageWire,
    FakeMarketTransport,
    listingWire,
    listingWireFor,
    marketProfileClientOver,
    MAKER,
    offerWireFrom,
    OTHER_MAKER,
    pageWire,
    reply,
} from './fixtures.js';
import { MARKET_MY_LISTINGS_PATH, MARKET_MY_OFFERS_PATH, MARKET_MY_OFFERS_RECEIVED_PATH } from '../constants.js';
import { MarketError } from '../error.js';
import { MarketErrorCode, MarketOfferKind } from '../types.js';

const listingItem = listingWireFor('1234', `0x${'a'.repeat(64)}`);
const offerItem = offerWireFrom(MarketOfferKind.Item, '1234', MAKER);
const listingPage = pageWire([listingItem], null);

describe('market profile reads', () => {
    it('adapts the backend HTTP profile DTO into the MCP page model', async () => {
        const transport = new FakeMarketTransport([
            reply(200, {
                listings: [
                    {
                        orderHash: listingWire.orderHash,
                        protocolAddress: listingWire.protocolAddress,
                        maker: listingWire.maker,
                        tokenId: listingWire.tokenId,
                        price: {
                            currencyAddress: listingWire.currency.address,
                            symbol: listingWire.currency.symbol,
                            decimals: listingWire.currency.decimals,
                            amountBaseUnits: listingWire.price,
                        },
                        startsAt: listingWire.startTime,
                        expiresAt: listingWire.expirationTime,
                    },
                ],
                cursor: null,
            }),
        ]);

        const page = await marketProfileClientOver(transport).getMyListings(null);

        expect(page).toEqual(listingPage);
    });

    it('omits a null cursor from the outgoing request instead of sending JSON null', async () => {
        const transport = new FakeMarketTransport([reply(200, backendListingPageWire([listingItem], null))]);

        await marketProfileClientOver(transport).getMyListings(null);

        expect(transport.calls[0]?.path).toBe(MARKET_MY_LISTINGS_PATH);
        expect(transport.calls[0]?.path).not.toMatch(/cursor/);
        expect(transport.calls[0]?.path).not.toMatch(/null/);
        expect(transport.calls[0]?.body).toBeNull();
    });

    it('carries a supplied cursor on the request for every profile feed', async () => {
        const cases = [
            {
                base: MARKET_MY_LISTINGS_PATH,
                page: backendListingPageWire([listingItem], null),
                read: 'getMyListings' as const,
            },
            {
                base: MARKET_MY_OFFERS_PATH,
                page: backendOfferPageWire([offerItem], null),
                read: 'getMyOffers' as const,
            },
            {
                base: MARKET_MY_OFFERS_RECEIVED_PATH,
                page: backendOfferPageWire([offerItem], null),
                read: 'getMyOffersReceived' as const,
            },
        ];

        for (const { base, page, read } of cases) {
            const transport = new FakeMarketTransport([reply(200, page)]);

            await marketProfileClientOver(transport)[read]('page-2');

            expect(transport.calls[0]?.path).toBe(`${base}?cursor=page-2`);
        }
    });

    it('percent-encodes a cursor that carries reserved characters', async () => {
        const transport = new FakeMarketTransport([reply(200, backendListingPageWire([listingItem], null))]);

        await marketProfileClientOver(transport).getMyListings('a b&c=d');

        expect(transport.calls[0]?.path).toBe(`${MARKET_MY_LISTINGS_PATH}?cursor=a+b%26c%3Dd`);
    });

    it('refuses an empty cursor before spending a request', async () => {
        const transport = new FakeMarketTransport([reply(200, backendListingPageWire([listingItem], null))]);

        const error = (await marketProfileClientOver(transport)
            .getMyListings('')
            .catch((e: unknown) => e)) as MarketError;

        expect(error).toBeInstanceOf(MarketError);
        expect(error.code).toBe(MarketErrorCode.InvalidInput);
        expect(transport.calls).toHaveLength(0);
    });

    it('keeps a next cursor on a short page rather than calling it the last page', async () => {
        const transport = new FakeMarketTransport([reply(200, backendListingPageWire([listingItem], 'page-2'))]);

        const page = await marketProfileClientOver(transport).getMyListings(null);

        expect(page.items).toHaveLength(1);
        expect(page.nextCursor).toBe('page-2');
    });

    it('preserves offers received from makers that are not the caller', async () => {
        const transport = new FakeMarketTransport([
            reply(
                200,
                backendOfferPageWire(
                    [
                        offerWireFrom(MarketOfferKind.Item, '1234', OTHER_MAKER),
                        offerWireFrom(MarketOfferKind.Collection, null, `0x${'3'.repeat(40)}`),
                    ],
                    null,
                ),
            ),
        ]);

        const page = await marketProfileClientOver(transport).getMyOffersReceived(null);

        expect(page.items.map((offer) => offer.maker)).toEqual([OTHER_MAKER, `0x${'3'.repeat(40)}`]);
    });

    it('rejects a page whose rows do not match the wire contract', async () => {
        const transport = new FakeMarketTransport([
            reply(200, backendListingPageWire([{ ...listingItem, price: 1.5 }], null)),
        ]);

        const error = (await marketProfileClientOver(transport)
            .getMyListings(null)
            .catch((e: unknown) => e)) as MarketError;

        expect(error).toBeInstanceOf(MarketError);
        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(error.retryable).toBe(false);
    });
});
