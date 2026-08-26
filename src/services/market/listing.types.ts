import { z } from 'zod';

import type { IMarketRecoveryStore, IMarketSingleFlight } from './action.types.js';
import type { IMarketProfileReader } from './profile.schemas.js';
import {
    baseUnitAmountSchema,
    cellTokenIdSchema,
    evmAddressSchema,
    marketCurrencySchema,
    marketFeeBreakdownSchema,
    marketListingSchema,
    marketPreparedIntentSchema,
    marketTransactionSchema,
    seaportOrderParametersSchema,
    unixSecondsSchema,
    type IMarketApiClient,
    type MarketActionStage,
    type MarketActionStatus,
    type MarketCurrency,
    type MarketListing,
} from './types.js';
import type { ILogger } from '../../logger/types.js';
import type { WalletProvider } from '../../wallet/types.js';

export const preparedListingTermsSchema = z.object({
    maker: evmAddressSchema,
    tokenId: cellTokenIdSchema,
    price: baseUnitAmountSchema,
    currency: marketCurrencySchema,
    startTime: unixSecondsSchema,
    expirationTime: unixSecondsSchema,
    buyerAddress: evmAddressSchema.nullable(),
});

export const prepareListingResponseSchema = marketPreparedIntentSchema.extend({
    listing: preparedListingTermsSchema,
    fees: marketFeeBreakdownSchema,
    transactions: z.array(marketTransactionSchema),
    order: seaportOrderParametersSchema,
});

export const submitListingResponseSchema = z.object({ listing: marketListingSchema });

export type PreparedListingTerms = z.infer<typeof preparedListingTermsSchema>;

export type PrepareListingResponse = z.infer<typeof prepareListingResponseSchema>;

export type SubmitListingResponse = z.infer<typeof submitListingResponseSchema>;

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
    client: IMarketApiClient;
    profile: IMarketProfileReader;
    wallet: WalletProvider;
    network: string;
    singleFlight: IMarketSingleFlight;
    recovery: IMarketRecoveryStore;
    logger: ILogger;
}

export interface IMarketListingService {
    listCell(request: ListCellRequest): Promise<ListCellResult>;
}
