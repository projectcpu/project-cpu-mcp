import { decodeFunctionData, hashStruct, type Abi, type Hex } from 'viem';

import { SEAPORT_CANCEL_ABI, SEAPORT_CANCEL_FUNCTION } from './cancel.abi.js';
import type { CancelOrderRequest, CancelledOrderCall } from './cancel.types.js';
import { MarketOrderKind, MarketTransactionKind, type MarketTransaction } from './types.js';
import { SEAPORT_ORDER_COMPONENTS_TYPES, SEAPORT_ORDER_PRIMARY_TYPE } from '../../contracts/seaport.constants.js';
import { SeaportItemType } from '../../contracts/seaport.types.js';

type SeaportStructTypes = Record<string, Array<{ name: string; type: string }>>;

const ORDER_STRUCT_TYPES = SEAPORT_ORDER_COMPONENTS_TYPES as unknown as SeaportStructTypes;

export function seaportOrderHash(order: Record<string, unknown>): string {
    return hashStruct({ data: order, types: ORDER_STRUCT_TYPES, primaryType: SEAPORT_ORDER_PRIMARY_TYPE });
}

export function cancellationActionInputs(request: CancelOrderRequest): Array<string | null> {
    return [request.orderHash.toLowerCase()];
}

export function cancellationTransaction(transactions: ReadonlyArray<MarketTransaction>): MarketTransaction | null {
    if (transactions.length !== 1) {
        return null;
    }

    const only = transactions[0] ?? null;
    return only !== null && only.kind === MarketTransactionKind.Cancellation ? only : null;
}

export function cancelledOrders(data: string): Array<CancelledOrderCall> | null {
    let decoded: { functionName: string; args: ReadonlyArray<unknown> | undefined };

    try {
        decoded = decodeFunctionData({ abi: SEAPORT_CANCEL_ABI as unknown as Abi, data: data as Hex });
    } catch {
        return null;
    }

    if (decoded.functionName !== SEAPORT_CANCEL_FUNCTION) {
        return null;
    }

    const orders = (decoded.args ?? [])[0];
    if (!Array.isArray(orders)) {
        return null;
    }

    return orders.map((order) => describeOrder(order as Record<string, unknown>));
}

function describeOrder(order: Record<string, unknown>): CancelledOrderCall {
    const offerer = order.offerer;
    const offeredCell = cellItem(order.offer);
    const requestedCell = cellItem(order.consideration);
    const kind = offeredCell !== null && requestedCell === null ? MarketOrderKind.Listing : MarketOrderKind.Offer;
    const cell = offeredCell ?? requestedCell;

    return {
        offerer: typeof offerer === 'string' ? offerer : '',
        orderHash: seaportOrderHash(order),
        kind: cell === null ? null : kind,
        tokenId: exactTokenId(cell),
    };
}

function cellItem(value: unknown): Record<string, unknown> | null {
    if (!Array.isArray(value)) {
        return null;
    }

    return (
        value.find((item) => {
            if (typeof item !== 'object' || item === null) {
                return false;
            }
            const itemType = Number((item as Record<string, unknown>).itemType);
            return itemType === SeaportItemType.Erc721 || itemType === SeaportItemType.Erc721WithCriteria;
        }) ?? null
    );
}

function exactTokenId(item: Record<string, unknown> | null): string | null {
    if (item === null || Number(item.itemType) !== SeaportItemType.Erc721) {
        return null;
    }

    const tokenId = item.identifierOrCriteria;
    return typeof tokenId === 'bigint' || typeof tokenId === 'number' || typeof tokenId === 'string'
        ? tokenId.toString()
        : null;
}
