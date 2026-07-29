import { parseEventLogs, type Address, type Log } from 'viem';

import { TRANSPORT_ABI } from '../contracts/transport.abi.js';

export interface ScheduledDelivery {
    deliveryId: bigint;
    sourceId: bigint;
    targetId: bigint;
    arrivalAt: bigint;
}

/**
 * Pulls the `DeliveryScheduled` event Transport emits on every scheduled move — whether the caller
 * moved directly or a trade write (create / buy / cancel) routed goods through it. Shared by
 * TransportService and TradeService so the receipt parse lives in one place.
 */
export function decodeDeliveryScheduled(logs: Array<Log>, transport: Address): ScheduledDelivery {
    const events = parseEventLogs({ abi: TRANSPORT_ABI, eventName: 'DeliveryScheduled', logs });
    const event = events.find((e) => e.address.toLowerCase() === transport.toLowerCase());
    if (event === undefined) {
        throw new Error('Move confirmed but Transport emitted no DeliveryScheduled event.');
    }
    return {
        deliveryId: event.args.deliveryId,
        sourceId: event.args.sourceId,
        targetId: event.args.targetId,
        arrivalAt: event.args.arrivalAt,
    };
}

export interface TransitLeg {
    gross: bigint;
    discount: bigint;
}

export interface TransitTotals {
    transitPaid: bigint;
    transitDiscount: bigint;
}

export function sumTransitFees(legs: Array<TransitLeg>): TransitTotals {
    let transitPaid = 0n;
    let transitDiscount = 0n;
    for (const leg of legs) {
        transitPaid += leg.gross - leg.discount;
        transitDiscount += leg.discount;
    }
    return { transitPaid, transitDiscount };
}

export function decodeTransitFees(logs: Array<Log>, transport: Address): Array<TransitLeg> {
    const events = parseEventLogs({ abi: TRANSPORT_ABI, eventName: 'TransitFeeSettled', logs });
    return events
        .filter((event) => event.address.toLowerCase() === transport.toLowerCase())
        .map((event) => ({ gross: event.args.gross, discount: event.args.discount }));
}

export function settleTransitFees(logs: Array<Log>, transport: Address, quoteFeeWei: bigint): TransitTotals {
    const legs = decodeTransitFees(logs, transport);
    if (legs.length === 0) {
        return { transitPaid: quoteFeeWei, transitDiscount: 0n };
    }
    return sumTransitFees(legs);
}
