import { EVICTED_BLOCK_NOTE, LIVE_LOT_COUNT_NOTE, WHOLE_UNITS_PATTERN } from './lot-terms.constants.js';

export function parseListedValue(value: string): bigint | null {
    if (!WHOLE_UNITS_PATTERN.test(value)) {
        return null;
    }
    const units = BigInt(value);
    return units > 0n ? units : null;
}

export function evictedPendingMessage(count: number, hubTokenId: string): string {
    return (
        `You still owe ${count} evicted lot return${count === 1 ? '' : 's'} on hub ${hubTokenId}, so this hub ` +
        `refuses every new lot of yours. Schedule the return of each evicted remainder there — ` +
        `${EVICTED_BLOCK_NOTE}.`
    );
}

export function invalidValueMessage(value: string): string {
    return `A lot needs a positive whole number of units; "${value}" is not one.`;
}

export function invalidPriceMessage(pricePerUnit: string): string {
    return `An asking price must be a positive $CPU amount per unit; "${pricePerUnit}" is not one.`;
}

export function priceBelowFloorMessage(pricePerUnit: string, floor: string): string {
    return (
        `Asking ${pricePerUnit} $CPU per unit is below the live floor of ${floor} $CPU per unit. ` +
        `Ask ${floor} or more.`
    );
}

export function emptyWindowMessage(hubTokenId: string, resourceId: number, min: string, max: string): string {
    return (
        `Hub ${hubTokenId} has no listing window for resource #${resourceId} right now: its live minimum is ` +
        `${min} units and its live maximum is ${max} units, so no amount fits. List on another hub, or wait ` +
        `for this hub's storage for that resource to change.`
    );
}

export function belowMinimumMessage(value: string, min: string, hubTokenId: string, resourceId: number): string {
    return (
        `A lot of ${value} units is below the live minimum of ${min} units for resource #${resourceId} on hub ` +
        `${hubTokenId}. List at least ${min} units, or pick a hub with a lower minimum.`
    );
}

export function aboveMaximumMessage(value: string, max: string, hubTokenId: string, resourceId: number): string {
    return (
        `A lot of ${value} units is above the live maximum of ${max} units for resource #${resourceId} on hub ` +
        `${hubTokenId}. List at most ${max} units, and sell the rest in a later lot or on another hub.`
    );
}

export function sellerLotLimitMessage(count: number, limit: number, hubTokenId: string, resourceId: number): string {
    return (
        `You already hold ${count} of ${limit} live lots for resource #${resourceId} on hub ${hubTokenId} — ` +
        `${LIVE_LOT_COUNT_NOTE}. Wait for one to sell out, or return one remainder home, before listing another.`
    );
}

export function saleFeeToleranceMessage(livePercent: number, tolerancePercent: number, hubTokenId: string): string {
    return (
        `Hub ${hubTokenId} charges ${livePercent}% sale fee, above your tolerance of ${tolerancePercent}%. ` +
        `Raise maxSaleFeePercent to ${livePercent} or more, or list on a cheaper hub.`
    );
}
