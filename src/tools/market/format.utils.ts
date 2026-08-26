import type { CellMarketSnapshot, MarketCurrency } from '../../services/market/types.js';

function describeMoney(amount: string, currency: MarketCurrency): string {
    return `${amount} ${currency.symbol} base units (decimals=${currency.decimals})`;
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
