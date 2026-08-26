import type { ListCellResult } from '../../services/market/listing.types.js';
import type { MarketListingPage, MarketOfferPage } from '../../services/market/profile.schemas.js';
import {
    MarketActionStatus,
    type CellMarketSnapshot,
    type MarketCurrency,
    type MarketListing,
    type MarketOffer,
} from '../../services/market/types.js';

function describeMoney(amount: string, currency: MarketCurrency): string {
    return `${amount} ${currency.symbol} base units (decimals=${currency.decimals})`;
}

function describeNextCursor(nextCursor: string | null): string {
    if (nextCursor === null) {
        return 'no further pages — nextCursor is null';
    }

    return `more pages remain — call again with cursor "${nextCursor}"`;
}

function describeListingRow(listing: MarketListing): string {
    return (
        `Cell ${listing.tokenId} — ${describeMoney(listing.price, listing.currency)}, ` +
        `expires at ${listing.expirationTime} (order ${listing.orderHash})`
    );
}

function describeOfferRow(offer: MarketOffer): string {
    const bound = offer.tokenId === null ? 'no bound Cell (criteria offer)' : `Cell ${offer.tokenId}`;

    return (
        `[${offer.kind}] ${bound} — ${describeMoney(offer.amount, offer.currency)} from ${offer.maker}, ` +
        `expires at ${offer.expirationTime} (order ${offer.orderHash})`
    );
}

export function summarizeListingPage(page: MarketListingPage): string {
    if (page.items.length === 0) {
        return [`Your Cell listings — no listings on this page`, describeNextCursor(page.nextCursor)].join('\n');
    }

    return [
        `Your Cell listings — ${page.items.length} on this page`,
        ...page.items.map(describeListingRow),
        describeNextCursor(page.nextCursor),
    ].join('\n');
}

export function summarizeOfferPage(heading: string, page: MarketOfferPage): string {
    if (page.items.length === 0) {
        return [`${heading} — no offers on this page`, describeNextCursor(page.nextCursor)].join('\n');
    }

    return [
        `${heading} — ${page.items.length} on this page`,
        ...page.items.map(describeOfferRow),
        describeNextCursor(page.nextCursor),
    ].join('\n');
}

export function summarizeListedCell(result: ListCellResult): string {
    const opening =
        result.status === MarketActionStatus.AlreadyCompleted
            ? `Cell ${result.tokenId} was already listed on these exact terms — no second listing was published`
            : `Cell ${result.tokenId} is listed`;
    const approvals =
        result.approvalTxHashes.length === 0
            ? 'no collection approval was needed'
            : `collection approvals broadcast in order: ${result.approvalTxHashes.join(', ')}`;

    return [
        `${opening} (order ${result.listing.orderHash}, seller ${result.wallet})`,
        `gross price: ${describeMoney(result.grossPrice, result.currency)}`,
        `platform fee ${result.platformFee}, creator fee ${result.creatorFee}, ` +
            `your estimated proceeds ${result.estimatedProceeds} (same base units)`,
        `expires at ${result.listing.expirationTime}`,
        approvals,
    ].join('\n');
}

export function summarizeCellMarket(snapshot: CellMarketSnapshot): string {
    const lines = [`Cell ${snapshot.tokenId} — marketplace snapshot`];

    if (snapshot.bestListing === null) {
        lines.push('best listing: none — this Cell is not for sale right now');
    } else {
        const listing = snapshot.bestListing;
        lines.push(
            `best listing: ${describeMoney(listing.price, listing.currency)} from ${listing.maker}, ` +
                `expires at ${listing.expirationTime} (order ${listing.orderHash})`,
        );
    }

    if (snapshot.bestOffer === null) {
        lines.push('best offer: none — nobody is bidding on this Cell right now');
    } else {
        const offer = snapshot.bestOffer;
        const bound = offer.tokenId === null ? 'no bound Cell (criteria offer)' : `Cell ${offer.tokenId}`;
        lines.push(
            `best offer [${offer.kind}]: ${describeMoney(offer.amount, offer.currency)} from ${offer.maker}, ` +
                `${bound}, expires at ${offer.expirationTime} (order ${offer.orderHash})`,
        );
    }

    return lines.join('\n');
}
