import { z } from 'zod';

import type { IMarketRecoveryStore, IMarketSingleFlight } from './action.types.js';
import type { IMarketSingleShotClient } from './client.types.js';
import type { IMarketFulfilmentProof } from './fulfilment-proof.types.js';
import {
    cellTokenIdSchema,
    chainIdSchema,
    evmAddressSchema,
    marketPreparedIntentSchema,
    marketTransactionSchema,
    orderHashSchema,
    MarketOrderKind,
    type MarketActionStage,
    type MarketActionStatus,
} from './types.js';
import type { ILogger } from '../../logger/types.js';
import type { WalletProvider } from '../../wallet/types.js';

export const cancellableOrderSchema = z.object({
    orderHash: orderHashSchema,
    protocolAddress: evmAddressSchema,
    chainId: chainIdSchema,
    maker: evmAddressSchema,
    kind: z.nativeEnum(MarketOrderKind),
    tokenId: cellTokenIdSchema.nullable(),
});

export const prepareCancellationResponseSchema = marketPreparedIntentSchema.extend({
    order: cancellableOrderSchema,
    transactions: z.array(marketTransactionSchema),
});

export type CancellableOrder = z.infer<typeof cancellableOrderSchema>;

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
