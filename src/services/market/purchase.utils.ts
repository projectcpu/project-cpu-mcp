import { zeroAddress } from 'viem';

import { sameAddress, sumBaseUnits } from './listing.utils.js';
import type { BuyCellRequest, PreparePurchaseResponse } from './purchase.types.js';
import { MarketTransactionKind, type MarketTransaction } from './types.js';

export function purchaseActionInputs(request: BuyCellRequest): Array<string | null> {
    return [request.tokenId, request.expectedOrderHash.toLowerCase(), request.maxAmount];
}

export function effectivePurchaseDeadline(prepared: PreparePurchaseResponse): number {
    return prepared.listing.expirationTime;
}

export function isNativeCurrency(address: string): boolean {
    return sameAddress(address, zeroAddress);
}

export function purchaseApprovals(prepared: PreparePurchaseResponse): Array<MarketTransaction> {
    return prepared.transactions.filter((transaction) => transaction.kind === MarketTransactionKind.CurrencyApproval);
}

export function purchaseFulfilment(prepared: PreparePurchaseResponse): MarketTransaction | null {
    const fulfilments = prepared.transactions.filter(
        (transaction) => transaction.kind === MarketTransactionKind.Fulfillment,
    );

    return fulfilments.length === 1 ? (fulfilments[0] ?? null) : null;
}

export function preparedNativeTotal(prepared: PreparePurchaseResponse): string {
    return sumBaseUnits(prepared.transactions.map((transaction) => transaction.value));
}

export function exceedsCeiling(amount: string, ceiling: string): boolean {
    return BigInt(amount) > BigInt(ceiling);
}

export function sameOrderHash(left: string, right: string): boolean {
    return left.toLowerCase() === right.toLowerCase();
}
