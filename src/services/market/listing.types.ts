import { z } from 'zod';

import type { IMarketRecoveryStore, IMarketSingleFlight } from './action.types.js';
import type { IMarketSingleShotClient } from './client.types.js';
import type { IMarketProfileReader } from './profile.schemas.js';
import {
    baseUnitAmountSchema,
    cellTokenIdSchema,
    chainIdSchema,
    evmAddressSchema,
    marketCurrencySchema,
    marketPreparedIntentSchema,
    marketTransactionSchema,
    orderHashSchema,
    seaportConsiderationItemSchema,
    seaportOrderParametersSchema,
    unixSecondsSchema,
    type MarketActionStage,
    type MarketActionStatus,
    type MarketCurrency,
    type MarketListing,
} from './types.js';
import type { ILogger } from '../../logger/types.js';
import type { WalletProvider } from '../../wallet/types.js';
import type { IAppConfig } from '../types.js';

export enum MarketScanOutcome {
    Found = 'found',
    Absent = 'absent',
    Exhausted = 'exhausted',
}

export interface MarketListingScan {
    outcome: MarketScanOutcome;
    listing: MarketListing | null;
}

export const preparedListingTermsSchema = z.object({
    maker: evmAddressSchema,
    tokenId: cellTokenIdSchema,
    price: baseUnitAmountSchema,
    currency: marketCurrencySchema,
    startTime: unixSecondsSchema,
    expirationTime: unixSecondsSchema,
    buyerAddress: evmAddressSchema.nullable(),
});

const marketPriceWireSchema = z.object({
    currencyAddress: evmAddressSchema,
    symbol: z.string().min(1),
    decimals: z.number().int().min(0).max(36),
    amountBaseUnits: baseUnitAmountSchema,
});

const listingFeePreviewWireSchema = z.object({
    grossPrice: marketPriceWireSchema,
    platformFee: marketPriceWireSchema,
    creatorFee: marketPriceWireSchema,
    estimatedProceeds: marketPriceWireSchema,
});

const prepareListingWireResponseSchema = marketPreparedIntentSchema.extend({
    order: seaportOrderParametersSchema,
    approvals: z.array(marketTransactionSchema),
    fees: listingFeePreviewWireSchema,
});

const submittedListingWireSchema = z.object({
    orderHash: orderHashSchema,
    protocolAddress: evmAddressSchema,
    maker: evmAddressSchema,
    tokenId: cellTokenIdSchema,
    price: marketPriceWireSchema,
    startsAt: unixSecondsSchema,
    expiresAt: unixSecondsSchema,
});

const currencyFrom = (price: z.infer<typeof marketPriceWireSchema>) => ({
    address: price.currencyAddress,
    symbol: price.symbol,
    decimals: price.decimals,
});

export const prepareListingResponseSchemaFor = (request: ListCellRequest) =>
    prepareListingWireResponseSchema.transform((data) => ({
        prepareId: data.prepareId,
        expiresAt: data.expiresAt,
        chainId: data.chainId,
        protocolAddress: data.protocolAddress,
        listing: {
            maker: data.order.offerer,
            tokenId: request.tokenId,
            price: data.fees.grossPrice.amountBaseUnits,
            currency: currencyFrom(data.fees.grossPrice),
            startTime: Number(data.order.startTime),
            expirationTime: Number(data.order.endTime),
            buyerAddress: request.buyerAddress,
        },
        fees: {
            platformFee: data.fees.platformFee.amountBaseUnits,
            creatorFee: data.fees.creatorFee.amountBaseUnits,
            estimatedProceeds: data.fees.estimatedProceeds.amountBaseUnits,
        },
        transactions: data.approvals,
        order: data.order,
    }));

export const submitListingResponseSchemaFor = (chainId: number) =>
    z.object({ listing: submittedListingWireSchema }).transform(({ listing }) => ({
        listing: {
            orderHash: listing.orderHash,
            protocolAddress: listing.protocolAddress,
            chainId: chainIdSchema.parse(chainId),
            maker: listing.maker,
            tokenId: listing.tokenId,
            price: listing.price.amountBaseUnits,
            currency: currencyFrom(listing.price),
            startTime: listing.startsAt,
            expirationTime: listing.expiresAt,
        },
    }));

export type SeaportConsiderationItem = z.infer<typeof seaportConsiderationItemSchema>;

export type PreparedListingTerms = z.infer<typeof preparedListingTermsSchema>;

export type PrepareListingResponse = z.infer<ReturnType<typeof prepareListingResponseSchemaFor>>;

export type SubmitListingResponse = z.infer<ReturnType<typeof submitListingResponseSchemaFor>>;

export interface ListCellRequest {
    tokenId: string;
    price: string;
    expirationTime: number;
    buyerAddress: string | null;
}

export interface ListCellResult {
    status: MarketActionStatus;
    stage: MarketActionStage;
    wallet: string;
    tokenId: string;
    listing: MarketListing;
    grossPrice: string;
    currency: MarketCurrency;
    platformFee: string;
    creatorFee: string;
    estimatedProceeds: string;
    approvalTxHashes: Array<string>;
}

export interface ListingRecoveryPayload {
    prepared: PrepareListingResponse | null;
    signature: string | null;
    approvalTxHashes: Array<string>;
}

export interface MarketListingServiceOptions {
    client: IMarketSingleShotClient;
    profile: IMarketProfileReader;
    appConfig: IAppConfig;
    wallet: WalletProvider;
    network: string;
    singleFlight: IMarketSingleFlight;
    recovery: IMarketRecoveryStore;
    logger: ILogger;
}

export interface IMarketListingService {
    listCell(request: ListCellRequest): Promise<ListCellResult>;
}
