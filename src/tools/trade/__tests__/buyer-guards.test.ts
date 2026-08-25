import { describe, expect, it } from 'vitest';

import { capture, evictedLot, fill, lot, buyResult, RESOURCES } from './fixtures.js';
import { type ApiFillView, type LotView, LotState } from '../../../api/types.js';
import { toFillView } from '../../../services/trade-fill.helpers.js';
import type { TradeQuote } from '../../../services/types.js';
import { registerBuyLotTool } from '../buy-lot/buy-lot.js';
import { summarizeLot } from '../format.utils.js';
import { registerQuoteBuyTool } from '../quote-buy/quote-buy.js';

const quote: TradeQuote = {
    lotId: 'lot-1',
    resourceId: 3,
    pricePerUnit: '0.5',
    value: '10',
    remaining: '80',
    routed: false,
    sale: '5',
    saleFeePercent: 1.5,
    discount: '0',
    salePaid: '5',
    tax: '0',
    ownerNet: '5',
    transitFee: null,
    transitDiscount: null,
    arrivalAt: null,
    total: '5',
};

interface Spy {
    reads: Array<string>;
    writes: Array<unknown>;
}

function buyerContext(observed: LotView): { trade: Record<string, unknown>; spy: Spy } {
    const spy: Spy = { reads: [], writes: [] };
    const trade = {
        getLot: async (lotId: string): Promise<LotView> => {
            spy.reads.push(lotId);
            return { ...observed, id: lotId };
        },
        quoteBuy: async (input: unknown): Promise<TradeQuote> => {
            spy.writes.push(input);
            return quote;
        },
        buyLot: async (input: unknown): Promise<typeof buyResult> => {
            spy.writes.push(input);
            return buyResult;
        },
    };
    return { trade, spy };
}

const NOT_OPEN: ReadonlyArray<LotState> = [LotState.Evicted, LotState.Delivering, LotState.Sold, LotState.Cancelled];

describe('quote_buy state guard', () => {
    it.each(NOT_OPEN)('refuses a %s lot without reaching the quote', async (state) => {
        const { trade, spy } = buyerContext({ ...lot, state });
        const handler = capture(registerQuoteBuyTool, { trade });
        await expect(handler({ lotId: 'lot-9', value: '10', chain: null } as never)).rejects.toThrow(/not open/i);
        expect(spy.reads).toEqual(['lot-9']);
        expect(spy.writes).toEqual([]);
    });

    it('names the lot return as the way an evicted lot leaves that state', async () => {
        const { trade } = buyerContext(evictedLot);
        const handler = capture(registerQuoteBuyTool, { trade });
        await expect(handler({ lotId: 'lot-9', value: '10', chain: null } as never)).rejects.toThrow(/lot return/i);
    });

    it('quotes an open lot and passes the arguments through untouched', async () => {
        const { trade, spy } = buyerContext(lot);
        const handler = capture(registerQuoteBuyTool, { trade });
        const result = await handler({ lotId: 'lot-1', value: '10', chain: [5, 6] } as never);
        expect(spy.writes).toEqual([{ lotId: 'lot-1', value: '10', chain: [5, 6] }]);
        expect(result.content[0]?.text).toMatch(/lot-1/);
    });
});

describe('buy_lot state guard', () => {
    it.each(NOT_OPEN)('refuses a %s lot before any approval or transaction', async (state) => {
        const { trade, spy } = buyerContext({ ...lot, state });
        const handler = capture(registerBuyLotTool, { trade });
        await expect(handler({ lotId: 'lot-9', value: '10', chain: [5, 6] } as never)).rejects.toThrow(/not open/i);
        expect(spy.reads).toEqual(['lot-9']);
        expect(spy.writes).toEqual([]);
    });

    it('says plainly that nothing was approved and nothing was sent', async () => {
        const { trade } = buyerContext(evictedLot);
        const handler = capture(registerBuyLotTool, { trade });
        await expect(handler({ lotId: 'lot-9', value: '10', chain: [5, 6] } as never)).rejects.toThrow(
            /no tokens were approved and no transaction was sent/i,
        );
    });

    it('buys an open lot and leaves the race to the contract', async () => {
        const { trade, spy } = buyerContext(lot);
        const handler = capture(registerBuyLotTool, { trade });
        const result = await handler({ lotId: 'lot-1', value: '10', chain: [5, 6] } as never);
        expect(spy.writes).toEqual([{ lotId: 'lot-1', chain: [5, 6], value: '10' }]);
        expect(result.content[0]?.text).toMatch(/Bought 10/);
    });
});

describe('direct lot lookup of an evicted lot', () => {
    it('describes the lot but states it cannot be bought', () => {
        const text = summarizeLot(evictedLot, RESOURCES);
        expect(text).toMatch(/lot-evicted/);
        expect(text).toMatch(/not for sale/i);
        expect(text).toMatch(/nobody can buy it/i);
    });
});

describe('historical fills after a later eviction', () => {
    it('keeps every settled fill — a fill carries no lifecycle state to invalidate it', () => {
        const rows: Array<ApiFillView> = [
            { ...fill, lotId: 'lot-evicted', logIndex: 1 },
            { ...fill, lotId: 'lot-evicted', logIndex: 2, remaining: '0' },
        ];
        const views = rows.map(toFillView);
        expect(views).toHaveLength(2);
        expect(views.map((view) => view.lotId)).toEqual(['lot-evicted', 'lot-evicted']);
        expect(views.map((view) => view.soldOut)).toEqual([false, true]);
        expect(Object.keys(views[0] ?? {})).not.toContain('state');
    });
});
