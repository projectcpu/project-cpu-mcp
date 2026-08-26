import { sameAddress, sumBaseUnits } from './listing.utils.js';
import type { MakeCellOfferRequest, PrepareOfferResponse } from './offer.types.js';
import { MarketOfferKind, type MarketOffer, type SeaportOrderParameters } from './types.js';
import { SeaportItemType } from '../../contracts/seaport.types.js';

export function offerActionInputs(request: MakeCellOfferRequest): Array<string | null> {
    return [request.tokenId, request.amount, request.expirationTime.toString()];
}

export function effectiveOfferDeadline(prepared: PrepareOfferResponse): number {
    return Math.min(prepared.expiresAt, prepared.offer.expirationTime);
}

export function isEquivalentActiveOffer(
    offer: MarketOffer,
    request: MakeCellOfferRequest,
    wallet: string,
    currency: string | null,
): boolean {
    if (currency !== null && !sameAddress(offer.currency.address, currency)) {
        return false;
    }

    return (
        sameAddress(offer.maker, wallet) &&
        offer.kind === MarketOfferKind.Item &&
        offer.tokenId === request.tokenId &&
        offer.amount === request.amount &&
        offer.expirationTime === request.expirationTime
    );
}

export function orderCurrencyConsiderationTotal(order: SeaportOrderParameters, currency: string): string {
    return sumBaseUnits(
        order.consideration
            .filter((item) => item.itemType !== SeaportItemType.Erc721 && sameAddress(item.token, currency))
            .map((item) => item.startAmount),
    );
}
