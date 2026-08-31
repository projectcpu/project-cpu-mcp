import { z } from 'zod';

import {
    baseUnitAmountSchema,
    cellTokenIdSchema,
    chainIdSchema,
    evmAddressSchema,
    MarketOfferKind,
    orderHashSchema,
    unixSecondsSchema,
} from './types.js';

export const marketPriceWireSchema = z.object({
    currencyAddress: evmAddressSchema,
    symbol: z.string().min(1),
    decimals: z.number().int().min(0).max(36),
    amountBaseUnits: baseUnitAmountSchema,
});

export const marketListingWireSchema = z.object({
    orderHash: orderHashSchema,
    protocolAddress: evmAddressSchema,
    maker: evmAddressSchema,
    tokenId: cellTokenIdSchema,
    price: marketPriceWireSchema,
    startsAt: unixSecondsSchema,
    expiresAt: unixSecondsSchema,
});

export const marketOfferWireSchema = z.object({
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

export const marketOfferFromWire = (offer: z.infer<typeof marketOfferWireSchema>, chainId: number) => ({
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
});

export const marketListingFromWire = (listing: z.infer<typeof marketListingWireSchema>, chainId: number) => ({
    orderHash: listing.orderHash,
    protocolAddress: listing.protocolAddress,
    chainId: chainIdSchema.parse(chainId),
    maker: listing.maker,
    tokenId: listing.tokenId,
    price: listing.price.amountBaseUnits,
    currency: currencyFrom(listing.price),
    startTime: listing.startsAt,
    expirationTime: listing.expiresAt,
});

export const cellMarketSnapshotResponseSchema = (chainId: number) =>
    z
        .object({
            tokenId: cellTokenIdSchema,
            bestListing: marketListingWireSchema.nullable(),
            bestOffer: marketOfferWireSchema.nullable(),
        })
        .transform((snapshot) => ({
            tokenId: snapshot.tokenId,
            bestListing: snapshot.bestListing === null ? null : marketListingFromWire(snapshot.bestListing, chainId),
            bestOffer: snapshot.bestOffer === null ? null : marketOfferFromWire(snapshot.bestOffer, chainId),
        }));
