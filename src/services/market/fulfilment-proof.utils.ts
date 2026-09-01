import { decodeEventLog, type Log } from 'viem';

import { SeaportOrderEvent } from './fulfilment-proof.types.js';
import { sameAddress } from './listing.utils.js';
import { SEAPORT_EVENTS_ABI } from '../../contracts/seaport-events.abi.js';
import { SEAPORT_ADDRESS } from '../../contracts/seaport.constants.js';

export interface SeaportSpentItem {
    token: string;
    identifier: string;
}

export interface SeaportFulfilmentEvent {
    orderHash: string;
    offerer: string;
    recipient: string;
    /** Every item the order moved — what the offerer gave and what it received, in one list. */
    items: Array<SeaportSpentItem>;
}

export interface SeaportCancellationEvent {
    orderHash: string;
    offerer: string;
}

function seaportEventArgs(logs: ReadonlyArray<Log>, event: SeaportOrderEvent): Array<Record<string, unknown>> {
    const decoded: Array<Record<string, unknown>> = [];

    for (const log of logs) {
        if (!sameAddress(log.address, SEAPORT_ADDRESS)) {
            continue;
        }

        try {
            const parsed = decodeEventLog({
                abi: SEAPORT_EVENTS_ABI,
                data: log.data,
                topics: log.topics as [signature: `0x${string}`, ...args: Array<`0x${string}`>],
            });
            if (parsed.eventName === event) {
                decoded.push(parsed.args as unknown as Record<string, unknown>);
            }
        } catch (_error) {
            continue;
        }
    }

    return decoded;
}

function spentItems(value: unknown): Array<SeaportSpentItem> {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.map((entry) => {
        const item = entry as Record<string, unknown>;
        const token = item.token;
        const identifier = item.identifier;

        return {
            token: typeof token === 'string' ? token : '',
            identifier: typeof identifier === 'bigint' ? identifier.toString() : String(identifier ?? ''),
        };
    });
}

function stringField(args: Record<string, unknown>, field: string): string {
    const value = args[field];
    return typeof value === 'string' ? value : '';
}

export function fulfilmentOfOrder(logs: ReadonlyArray<Log>, orderHash: string): SeaportFulfilmentEvent | null {
    for (const args of seaportEventArgs(logs, SeaportOrderEvent.Fulfilled)) {
        if (stringField(args, 'orderHash').toLowerCase() !== orderHash.toLowerCase()) {
            continue;
        }

        return {
            orderHash: stringField(args, 'orderHash'),
            offerer: stringField(args, 'offerer'),
            recipient: stringField(args, 'recipient'),
            items: [...spentItems(args.offer), ...spentItems(args.consideration)],
        };
    }

    return null;
}

export function cancellationOfOrder(logs: ReadonlyArray<Log>, orderHash: string): SeaportCancellationEvent | null {
    for (const args of seaportEventArgs(logs, SeaportOrderEvent.Cancelled)) {
        if (stringField(args, 'orderHash').toLowerCase() !== orderHash.toLowerCase()) {
            continue;
        }

        return { orderHash: stringField(args, 'orderHash'), offerer: stringField(args, 'offerer') };
    }

    return null;
}
