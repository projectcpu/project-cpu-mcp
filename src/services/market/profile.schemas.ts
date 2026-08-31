import { z } from 'zod';

import {
    baseUnitAmountSchema,
    cellTokenIdSchema,
    chainIdSchema,
    cursorSchema,
    evmAddressSchema,
    MarketOfferKind,
    marketListingSchema,
    marketOfferSchema,
    marketPageSchema,
    orderHashSchema,
    unixSecondsSchema,
} from './types.js';
import type { IMarketApiClient } from './types.js';
import type { ILogger } from '../../logger/types.js';

export const marketListingPageSchema = marketPageSchema(marketListingSchema);

export const marketOfferPageSchema = marketPageSchema(marketOfferSchema);

const marketPriceWireSchema = z.object({
    currencyAddress: evmAddressSchema,
    symbol: z.string().min(1),
    decimals: z.number().int().min(0).max(36),
    amountBaseUnits: baseUnitAmountSchema,
});

const marketListingWireSchema = z.object({
    orderHash: orderHashSchema,
    protocolAddress: evmAddressSchema,
    maker: evmAddressSchema,
    tokenId: cellTokenIdSchema,
    price: marketPriceWireSchema,
    startsAt: unixSecondsSchema,
    expiresAt: unixSecondsSchema,
});

const marketOfferWireSchema = z.object({
    orderHash: orderHashSchema,
    protocolAddress: evmAddressSchema,
    maker: evmAddressSchema,
    kind: z.nativeEnum(MarketOfferKind),
    tokenId: cellTokenIdSchema.nullable(),
    price: marketPriceWireSchema,
    startsAt: unixSecondsSchema,
    expiresAt: unixSecondsSchema,
});

const currencyFrom = (price: z.infer<typeof marketPriceWireSchema>) => ({
    address: price.currencyAddress,
    symbol: price.symbol,
    decimals: price.decimals,
});

export const marketListingPageResponseSchema = (chainId: number) =>
    z.object({ listings: z.array(marketListingWireSchema), cursor: cursorSchema.nullable() }).transform((data) => ({
        items: data.listings.map((listing) => ({
            orderHash: listing.orderHash,
            protocolAddress: listing.protocolAddress,
            chainId: chainIdSchema.parse(chainId),
            maker: listing.maker,
            tokenId: listing.tokenId,
            price: listing.price.amountBaseUnits,
            currency: currencyFrom(listing.price),
            startTime: listing.startsAt,
            expirationTime: listing.expiresAt,
        })),
        nextCursor: data.cursor,
    }));

export const marketOfferPageResponseSchema = (chainId: number) =>
    z.object({ offers: z.array(marketOfferWireSchema), cursor: cursorSchema.nullable() }).transform((data) => ({
        items: data.offers.map((offer) => ({
            orderHash: offer.orderHash,
            protocolAddress: offer.protocolAddress,
            chainId: chainIdSchema.parse(chainId),
            maker: offer.maker,
            kind: offer.kind,
            tokenId: offer.tokenId,
            amount: offer.price.amountBaseUnits,
            currency: currencyFrom(offer.price),
            startTime: offer.startsAt,
            expirationTime: offer.expiresAt,
        })),
        nextCursor: data.cursor,
    }));

export type MarketListingPage = z.infer<typeof marketListingPageSchema>;

export type MarketOfferPage = z.infer<typeof marketOfferPageSchema>;

export interface MarketProfileClientOptions {
    client: IMarketApiClient;
    chainId: number;
    logger: ILogger;
}

export interface IMarketProfileReader {
    getMyListings(cursor: string | null): Promise<MarketListingPage>;
    getMyOffers(cursor: string | null): Promise<MarketOfferPage>;
    getMyOffersReceived(cursor: string | null): Promise<MarketOfferPage>;
}
