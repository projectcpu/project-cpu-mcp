import { describe, expect, it } from 'vitest';

import {
    emptySnapshotWire,
    listingWire,
    offerWire,
    snapshotWire,
} from '../../../services/market/__tests__/fixtures.js';
import { cellMarketSnapshotSchema, MarketOfferKind } from '../../../services/market/types.js';
import { summarizeCellMarket } from '../format.utils.js';

const HUGE_BASE_UNITS = '1234567890123456789012345678';

function summarize(wire: unknown): string {
    return summarizeCellMarket(cellMarketSnapshotSchema.parse(wire));
}

describe('summarizeCellMarket', () => {
    it('names the Cell and both sides of its market', () => {
        const summary = summarize(snapshotWire);

        expect(summary).toMatch(/^Cell 1234 — marketplace snapshot/);
        expect(summary).toContain(listingWire.price);
        expect(summary).toContain(listingWire.maker);
        expect(summary).toContain(listingWire.orderHash);
        expect(summary).toMatch(/best offer \[item\]/);
        expect(summary).toContain('Cell 1234');
    });

    it('reports an untraded Cell as none on both sides', () => {
        const summary = summarize(emptySnapshotWire);

        expect(summary).toMatch(/best listing: none/);
        expect(summary).toMatch(/best offer: none/);
    });

    it('keeps every amount in base units, never through a JavaScript number', () => {
        const summary = summarize({
            ...snapshotWire,
            bestListing: { ...listingWire, price: HUGE_BASE_UNITS },
            bestOffer: { ...offerWire(MarketOfferKind.Item, '1234'), amount: HUGE_BASE_UNITS },
        });

        expect(summary).toContain(`${HUGE_BASE_UNITS} WETH base units (decimals=18)`);
        expect(summary.match(new RegExp(HUGE_BASE_UNITS, 'g'))).toHaveLength(2);
        expect(summary).not.toContain(String(Number(HUGE_BASE_UNITS)));
        expect(summary).not.toMatch(/e[+-]\d/i);
        expect(summary).not.toMatch(/\d\.\d/);
    });

    it('says a criteria offer is bound to no Cell rather than printing a null one', () => {
        const summary = summarize({ ...snapshotWire, bestOffer: offerWire(MarketOfferKind.Collection, null) });

        expect(summary).toMatch(/best offer \[collection\]/);
        expect(summary).toContain('no bound Cell (criteria offer)');
        expect(summary).not.toContain('Cell null');
    });
});
