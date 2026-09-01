import { z } from 'zod';

import type { IMarketRecoveryStore, IMarketSingleFlight } from './action.types.js';
import type { IMarketSingleShotClient } from './client.types.js';
import type { IMarketFulfilmentProof } from './fulfilment-proof.types.js';
import {
    evmAddressSchema,
    marketTransactionSchema,
    orderHashSchema,
    MarketOrderKind,
    type MarketActionStage,
    type MarketActionStatus,
} from './types.js';
import type { ILogger } from '../../logger/types.js';
import type { WalletProvider } from '../../wallet/types.js';

export const prepareCancellationResponseSchema = z.object({
    orderHash: orderHashSchema,
    protocolAddress: evmAddressSchema,
    transaction: marketTransactionSchema,
});

export type PrepareCancellationResponse = z.infer<typeof prepareCancellationResponseSchema>;

export interface CancelOrderRequest {
    orderHash: string;
}

export interface CancelOrderResult {
    status: MarketActionStatus;
    stage: MarketActionStage;
    wallet: string;
    orderHash: string;
    orderKind: MarketOrderKind;
    tokenId: string | null;
    cancellationTxHash: string;
    txHashes: Array<string>;
}

export interface CancellationRecoveryPayload {
    prepared: PrepareCancellationResponse | null;
    cancellationTxHash: string | null;
}

export interface CancelledOrderCall {
    offerer: string;
    orderHash: string;
    kind: MarketOrderKind | null;
    tokenId: string | null;
}

export interface MarketCancelServiceOptions {
    client: IMarketSingleShotClient;
    proof: IMarketFulfilmentProof;
    wallet: WalletProvider;
    network: string;
    singleFlight: IMarketSingleFlight;
    recovery: IMarketRecoveryStore;
    logger: ILogger;
}

export interface IMarketCancelService {
    cancelOrder(request: CancelOrderRequest): Promise<CancelOrderResult>;
}
