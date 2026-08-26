import { z } from 'zod';

import type { IMarketRecoveryStore, IMarketSingleFlight } from './action.types.js';
import type { IMarketSingleShotClient } from './client.types.js';
import type { MarketScanOutcome } from './listing.types.js';
import type { IMarketProfileReader } from './profile.schemas.js';
import {
    baseUnitAmountSchema,
    cellTokenIdSchema,
    evmAddressSchema,
    marketCurrencySchema,
    marketOfferSchema,
    marketPreparedIntentSchema,
    marketTransactionSchema,
    MarketOfferKind,
    seaportOrderParametersSchema,
    unixSecondsSchema,
    type MarketActionStage,
    type MarketActionStatus,
    type MarketCurrency,
    type MarketOffer,
} from './types.js';
import type { ILogger } from '../../logger/types.js';
import type { WalletProvider } from '../../wallet/types.js';
import type { IAppConfig } from '../types.js';

export interface MarketOfferScan {
    outcome: MarketScanOutcome;
    offer: MarketOffer | null;
}

export const preparedOfferTermsSchema = z.object({
    maker: evmAddressSchema,
    kind: z.nativeEnum(MarketOfferKind),
    tokenId: cellTokenIdSchema,
    amount: baseUnitAmountSchema,
    currency: marketCurrencySchema,
    counter: baseUnitAmountSchema,
    startTime: unixSecondsSchema,
    expirationTime: unixSecondsSchema,
});

export const prepareOfferResponseSchema = marketPreparedIntentSchema.extend({
    offer: preparedOfferTermsSchema,
    transactions: z.array(marketTransactionSchema),
    order: seaportOrderParametersSchema,
});

export const submitOfferResponseSchema = z.object({ offer: marketOfferSchema });

export type PreparedOfferTerms = z.infer<typeof preparedOfferTermsSchema>;

export type PrepareOfferResponse = z.infer<typeof prepareOfferResponseSchema>;

export type SubmitOfferResponse = z.infer<typeof submitOfferResponseSchema>;

export interface MakeCellOfferRequest {
    tokenId: string;
    amount: string;
    expirationTime: number;
}

export interface MakeCellOfferResult {
    status: MarketActionStatus;
    stage: MarketActionStage;
    wallet: string;
    tokenId: string;
    offer: MarketOffer;
    amount: string;
    currency: MarketCurrency;
    approvalTxHashes: Array<string>;
}

export interface OfferRecoveryPayload {
    prepared: PrepareOfferResponse | null;
    signature: string | null;
    approvalTxHashes: Array<string>;
}

export interface MarketOfferServiceOptions {
    client: IMarketSingleShotClient;
    profile: IMarketProfileReader;
    appConfig: IAppConfig;
    wallet: WalletProvider;
    network: string;
    singleFlight: IMarketSingleFlight;
    recovery: IMarketRecoveryStore;
    logger: ILogger;
}

export interface IMarketOfferService {
    makeCellOffer(request: MakeCellOfferRequest): Promise<MakeCellOfferResult>;
}
