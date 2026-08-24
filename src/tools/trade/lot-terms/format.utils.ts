import { CANNOT_LIST_LINE, CAN_LIST_LINE, NO_EVICTED_LINE } from './constants.js';
import { LotListingBlocker, type LotTermsResult } from '../../../services/types.js';
import { resourceLabel, type ResourceNames } from '../../../utils/format.utils.js';

function describeBlocker(blocker: LotListingBlocker, terms: LotTermsResult): string {
    switch (blocker) {
        case LotListingBlocker.EvictedPending:
            return (
                `${terms.outstandingEvictedCount} evicted remainder(s) of yours on this hub still owe a return ` +
                `home — schedule each one and the hub takes your lots again, for every resource.`
            );
        case LotListingBlocker.EmptyWindow:
            return (
                `the hub has no room for a lot of this resource: its window runs from ${terms.effectiveMin} to ` +
                `${terms.effectiveMax} units, so no amount fits — list elsewhere.`
            );
        case LotListingBlocker.SellerLotLimit:
            return (
                `you already hold ${terms.sellerLotCount} of ${terms.sellerLotLimit} live lots here — wait for ` +
                `one to sell out, or return one remainder home.`
            );
    }
}

export function summarizeLotTerms(terms: LotTermsResult, resources: ResourceNames): string {
    const header =
        `Hub ${terms.hubTokenId}, ${resourceLabel(resources, terms.resourceId)}: one new lot may hold ` +
        `${terms.effectiveMin}–${terms.effectiveMax} units (read from the Trade contract for this hub and ` +
        `resource). You hold ${terms.sellerLotCount} of ${terms.sellerLotLimit} live lots here — delivering, ` +
        `open and evicted ones all count.`;
    const evicted =
        terms.outstandingEvictedCount === 0
            ? NO_EVICTED_LINE
            : `${terms.outstandingEvictedCount} evicted remainder(s) owed a return on this hub.`;
    const verdict = terms.canList
        ? CAN_LIST_LINE
        : [CANNOT_LIST_LINE, ...terms.blockers.map((blocker) => `- ${describeBlocker(blocker, terms)}`)].join('\n');

    return `${header} ${evicted}\n${verdict}`;
}
