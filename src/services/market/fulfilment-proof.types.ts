import type { MarketActionStage } from './types.js';
import type { ILogger } from '../../logger/types.js';
import type { TxReceipt, WalletProvider } from '../../wallet/types.js';

export enum SeaportOrderEvent {
    Fulfilled = 'OrderFulfilled',
    Cancelled = 'OrderCancelled',
}

export interface BoundCellItem {
    collection: string;
    tokenId: string;
}

export interface OrderProofRequest {
    receipt: TxReceipt;
    orderHash: string;
    wallet: string;
    stage: MarketActionStage;
    /** The one Cell this action was allowed to move; null where the proof binds no Cell. */
    boundCell: BoundCellItem | null;
}

export interface OrderFulfilmentProof {
    orderHash: string;
    offerer: string;
    recipient: string;
    sender: string;
}

export interface OrderCancellationProof {
    orderHash: string;
    offerer: string;
    sender: string;
}

export interface IFulfilmentTransactionReader {
    senderOf(txHash: string): Promise<string | null>;
}

export interface WalletTransactionReaderOptions {
    wallet: WalletProvider;
    logger: ILogger;
}

export interface MarketFulfilmentProofOptions {
    transactions: IFulfilmentTransactionReader;
    logger: ILogger;
}

export interface IMarketFulfilmentProof {
    requireFulfilment(request: OrderProofRequest): Promise<OrderFulfilmentProof>;
    requireCancellation(request: OrderProofRequest): Promise<OrderCancellationProof>;
}
