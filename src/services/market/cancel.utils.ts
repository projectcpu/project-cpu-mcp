import { decodeFunctionData, hashStruct, type Abi, type Hex } from 'viem';

import { SEAPORT_CANCEL_ABI, SEAPORT_CANCEL_FUNCTION } from './cancel.abi.js';
import type { CancelOrderRequest, CancelledOrderCall } from './cancel.types.js';
import { MarketTransactionKind, type MarketTransaction } from './types.js';
import { SEAPORT_ORDER_COMPONENTS_TYPES, SEAPORT_ORDER_PRIMARY_TYPE } from '../../contracts/seaport.constants.js';

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

    return { offerer: typeof offerer === 'string' ? offerer : '', orderHash: seaportOrderHash(order) };
}
