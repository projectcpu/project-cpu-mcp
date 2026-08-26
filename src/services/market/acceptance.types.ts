import { z } from 'zod';

import type { IMarketRecoveryStore, IMarketSingleFlight } from './action.types.js';
import type { IMarketSingleShotClient } from './client.types.js';
import type { IMarketFulfilmentProof } from './fulfilment-proof.types.js';
import {
    bytes32Schema,
    cellTokenIdSchema,
    marketOfferSchema,
    marketPreparedIntentSchema,
    marketTransactionSchema,
    type MarketActionStage,
    type MarketActionStatus,
    type MarketCurrency,
    type MarketOffer,
} from './types.js';
import type { ILogger } from '../../logger/types.js';
import type { WalletProvider } from '../../wallet/types.js';
import type { IAppConfig } from '../types.js';

export const prepareAcceptanceResponseSchema = marketPreparedIntentSchema.extend({
    offer: marketOfferSchema,
    tokenId: cellTokenIdSchema,
    conduitKey: bytes32Schema,
    transactions: z.array(marketTransactionSchema),
});

export type PrepareAcceptanceResponse = z.infer<typeof prepareAcceptanceResponseSchema>;

export interface AcceptCellOfferRequest {
    orderHash: string;
    tokenId: string | null;
}

export interface AcceptCellOfferResult {
    status: MarketActionStatus;
    stage: MarketActionStage;
    wallet: string;
    tokenId: string;
    orderHash: string;
    offer: MarketOffer;
    buyer: string;
    amount: string;
    currency: MarketCurrency;
    approvalTxHashes: Array<string>;
    fulfilmentTxHash: string;
    txHashes: Array<string>;
}

export interface AcceptanceRecoveryPayload {
    prepared: PrepareAcceptanceResponse | null;
    approvalTxHashes: Array<string>;
    fulfilmentTxHash: string | null;
}

export interface MarketAcceptanceServiceOptions {
    client: IMarketSingleShotClient;
    proof: IMarketFulfilmentProof;
    appConfig: IAppConfig;
    wallet: WalletProvider;
    network: string;
    singleFlight: IMarketSingleFlight;
    recovery: IMarketRecoveryStore;
    logger: ILogger;
}

export interface IMarketAcceptanceService {
    acceptCellOffer(request: AcceptCellOfferRequest): Promise<AcceptCellOfferResult>;
}
