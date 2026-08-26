import type { ListCellRequest, PrepareListingResponse } from './listing.types.js';
import type { MarketListing, SeaportOrderParameters } from './types.js';

export function sameAddress(left: string, right: string): boolean {
    return left.toLowerCase() === right.toLowerCase();
}

export function sameOptionalAddress(left: string | null, right: string | null): boolean {
    if (left === null || right === null) {
        return left === right;
    }
    return sameAddress(left, right);
}

export function sumBaseUnits(values: ReadonlyArray<string>): string {
    return values.reduce((total, value) => total + BigInt(value), 0n).toString();
}

export function listingActionInputs(request: ListCellRequest): Array<string | null> {
    return [
        request.tokenId,
        request.price,
        request.expirationTime.toString(),
        request.buyerAddress === null ? null : request.buyerAddress.toLowerCase(),
    ];
}

export function effectiveListingDeadline(prepared: PrepareListingResponse): number {
    return Math.min(prepared.expiresAt, prepared.listing.expirationTime);
}

export function isEquivalentActiveListing(listing: MarketListing, request: ListCellRequest, wallet: string): boolean {
    return (
        sameAddress(listing.maker, wallet) &&
        listing.tokenId === request.tokenId &&
        listing.price === request.price &&
        listing.expirationTime === request.expirationTime
    );
}

export function seaportSignableOrder(order: SeaportOrderParameters): Record<string, unknown> {
    return {
        offerer: order.offerer,
        zone: order.zone,
        offer: order.offer,
        consideration: order.consideration,
        orderType: order.orderType,
        startTime: order.startTime,
        endTime: order.endTime,
        zoneHash: order.zoneHash,
        salt: order.salt,
        conduitKey: order.conduitKey,
        counter: order.counter,
    };
}

export function considerationStartTotal(order: SeaportOrderParameters): string {
    return sumBaseUnits(order.consideration.map((item) => item.startAmount));
}

export function recipientConsiderationTotal(order: SeaportOrderParameters, recipient: string): string {
    return sumBaseUnits(
        order.consideration.filter((item) => sameAddress(item.recipient, recipient)).map((item) => item.startAmount),
    );
}
