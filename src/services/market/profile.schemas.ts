import { z } from 'zod';

import {
    marketListingFromWire,
    marketListingWireSchema,
    marketOfferFromWire,
    marketOfferWireSchema,
} from './snapshot.schemas.js';
import {
    baseUnitAmountSchema,
    cellTokenIdSchema,
    chainIdSchema,
    cursorSchema,
    MarketOrderKind,
    MarketOfferKind,
    marketPageSchema,
    orderHashSchema,
} from './types.js';
import type { IMarketApiClient } from './types.js';
import type { ILogger } from '../../logger/types.js';

const marketProfilePriceWireSchema = z.object({
    symbol: z.string().min(1),
    decimals: z.number().int().min(0).max(36),
    amountBaseUnits: baseUnitAmountSchema,
});

const marketProfileListingWireSchema = z.object({
    orderHash: orderHashSchema,
    tokenId: cellTokenIdSchema,
    price: marketProfilePriceWireSchema,
});

const marketProfileOfferWireSchema = z.object({
    orderHash: orderHashSchema,
    kind: z.nativeEnum(MarketOfferKind),
    tokenId: cellTokenIdSchema.nullable(),
    price: marketProfilePriceWireSchema,
});

export const marketProfileCurrencySchema = z.object({
    symbol: z.string().min(1),
    decimals: z.number().int().min(0).max(36),
});

export const marketProfileListingSchema = z.object({
    orderHash: orderHashSchema,
    chainId: chainIdSchema,
    tokenId: cellTokenIdSchema,
    price: baseUnitAmountSchema,
    currency: marketProfileCurrencySchema,
});

export const marketProfileOfferSchema = z.object({
    orderHash: orderHashSchema,
    chainId: chainIdSchema,
    kind: z.nativeEnum(MarketOfferKind),
    tokenId: cellTokenIdSchema.nullable(),
    amount: baseUnitAmountSchema,
    currency: marketProfileCurrencySchema,
});

export const marketListingPageSchema = marketPageSchema(marketProfileListingSchema);

export const marketOfferPageSchema = marketPageSchema(marketProfileOfferSchema);

const currencyFrom = (price: z.infer<typeof marketProfilePriceWireSchema>) => ({
    symbol: price.symbol,
    decimals: price.decimals,
});

export const marketListingPageResponseSchema = (chainId: number) =>
    z
        .object({ listings: z.array(marketProfileListingWireSchema), cursor: cursorSchema.nullable() })
        .transform((data) => ({
            items: data.listings.map((listing) => ({
                orderHash: listing.orderHash,
                chainId: chainIdSchema.parse(chainId),
                tokenId: listing.tokenId,
                price: listing.price.amountBaseUnits,
                currency: currencyFrom(listing.price),
            })),
            nextCursor: data.cursor,
        }));

export const marketOfferPageResponseSchema = (chainId: number) =>
    z.object({ offers: z.array(marketProfileOfferWireSchema), cursor: cursorSchema.nullable() }).transform((data) => ({
        items: data.offers.map((offer) => ({
            orderHash: offer.orderHash,
            chainId: chainIdSchema.parse(chainId),
            kind: offer.kind,
            tokenId: offer.tokenId,
            amount: offer.price.amountBaseUnits,
            currency: currencyFrom(offer.price),
        })),
        nextCursor: data.cursor,
    }));

export const marketOrderDetailsResponseSchema = (chainId: number) =>
    z
        .object({
            orderKind: z.nativeEnum(MarketOrderKind),
            listing: marketListingWireSchema.nullable(),
            offer: marketOfferWireSchema.nullable(),
        })
        .transform((details, context) => {
            if (details.orderKind === MarketOrderKind.Listing && details.listing !== null && details.offer === null) {
                return { orderKind: details.orderKind, order: marketListingFromWire(details.listing, chainId) };
            }
            if (details.orderKind === MarketOrderKind.Offer && details.offer !== null && details.listing === null) {
                return { orderKind: details.orderKind, order: marketOfferFromWire(details.offer, chainId) };
            }
            context.addIssue({ code: 'custom', message: 'order kind does not match the populated order field' });
            return z.NEVER;
        });

export type MarketListingPage = z.infer<typeof marketListingPageSchema>;

export type MarketOfferPage = z.infer<typeof marketOfferPageSchema>;

export type MarketOrderDetails = z.infer<ReturnType<typeof marketOrderDetailsResponseSchema>>;

export interface MarketProfileClientOptions {
    client: IMarketApiClient;
    chainId: number;
    logger: ILogger;
}

export interface IMarketProfileReader {
    getMyListings(cursor: string | null): Promise<MarketListingPage>;
    getMyOffers(cursor: string | null): Promise<MarketOfferPage>;
    getMyOffersReceived(cursor: string | null): Promise<MarketOfferPage>;
    getOrderDetails(orderHash: string): Promise<MarketOrderDetails>;
}
