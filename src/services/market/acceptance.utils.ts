import type { AcceptCellOfferRequest, PrepareAcceptanceResponse } from './acceptance.types.js';
import { MarketTransactionKind, type MarketTransaction } from './types.js';

export function acceptanceActionInputs(request: AcceptCellOfferRequest): Array<string | null> {
    return [request.orderHash.toLowerCase(), request.tokenId];
}

export function effectiveAcceptanceDeadline(prepared: PrepareAcceptanceResponse): number {
    return Math.min(prepared.expiresAt, prepared.offer.expirationTime);
}

export function acceptanceApprovals(prepared: PrepareAcceptanceResponse): Array<MarketTransaction> {
    return prepared.transactions.filter((transaction) => transaction.kind === MarketTransactionKind.CollectionApproval);
}

export function acceptanceFulfilment(prepared: PrepareAcceptanceResponse): MarketTransaction | null {
    const fulfilments = prepared.transactions.filter(
        (transaction) => transaction.kind === MarketTransactionKind.Fulfilment,
    );

    return fulfilments.length === 1 ? (fulfilments[0] ?? null) : null;
}
