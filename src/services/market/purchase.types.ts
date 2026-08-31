import { z } from 'zod';

import type { IMarketRecoveryStore, IMarketSingleFlight } from './action.types.js';
import type { IMarketSingleShotClient } from './client.types.js';
import type { IMarketFulfilmentProof } from './fulfilment-proof.types.js';
import { marketListingFromWire, marketListingWireSchema } from './snapshot.schemas.js';
import {
    marketTransactionSchema,
    type MarketActionStage,
    type MarketActionStatus,
    type MarketCurrency,
} from './types.js';
import type { ILogger } from '../../logger/types.js';
import type { WalletProvider } from '../../wallet/types.js';
import type { IAppConfig } from '../types.js';

export const preparePurchaseResponseSchema = (chainId: number) =>
    z
        .object({
            listing: marketListingWireSchema,
            transactions: z.array(marketTransactionSchema),
        })
        .transform((prepared) => ({
            listing: marketListingFromWire(prepared.listing, chainId),
            transactions: prepared.transactions,
        }));

export type PreparePurchaseResponse = z.infer<ReturnType<typeof preparePurchaseResponseSchema>>;

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
