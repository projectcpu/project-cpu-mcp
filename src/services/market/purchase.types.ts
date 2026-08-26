import { z } from 'zod';

import type { IMarketRecoveryStore, IMarketSingleFlight } from './action.types.js';
import type { IMarketSingleShotClient } from './client.types.js';
import type { IMarketFulfilmentProof } from './fulfilment-proof.types.js';
import {
    marketListingSchema,
    marketPreparedIntentSchema,
    marketTransactionSchema,
    type MarketActionStage,
    type MarketActionStatus,
    type MarketCurrency,
} from './types.js';
import type { ILogger } from '../../logger/types.js';
import type { WalletProvider } from '../../wallet/types.js';
import type { IAppConfig } from '../types.js';

export const preparePurchaseResponseSchema = marketPreparedIntentSchema.extend({
    listing: marketListingSchema,
    transactions: z.array(marketTransactionSchema),
});

export type PreparePurchaseResponse = z.infer<typeof preparePurchaseResponseSchema>;

export interface BuyCellRequest {
    tokenId: string;
    expectedOrderHash: string;
    maxAmount: string;
}

export interface BuyCellResult {
    status: MarketActionStatus;
    stage: MarketActionStage;
    wallet: string;
    tokenId: string;
    orderHash: string;
    seller: string;
    price: string;
    currency: MarketCurrency;
    maxAmount: string;
    approvalTxHashes: Array<string>;
    fulfilmentTxHash: string;
    txHashes: Array<string>;
}

export interface PurchaseRecoveryPayload {
    prepared: PreparePurchaseResponse | null;
    approvalTxHashes: Array<string>;
    fulfilmentTxHash: string | null;
}

export interface MarketPurchaseServiceOptions {
    client: IMarketSingleShotClient;
    proof: IMarketFulfilmentProof;
    appConfig: IAppConfig;
    wallet: WalletProvider;
    network: string;
    singleFlight: IMarketSingleFlight;
    recovery: IMarketRecoveryStore;
    logger: ILogger;
}

export interface IMarketPurchaseService {
    buyCell(request: BuyCellRequest): Promise<BuyCellResult>;
}
