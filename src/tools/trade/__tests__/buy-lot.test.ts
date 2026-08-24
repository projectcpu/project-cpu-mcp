import { describe, expect, it } from 'vitest';

import { buyResult, capture } from './fixtures.js';
import type { TradeQuote } from '../../../services/types.js';
import { ToolEventType } from '../../types.js';
import { registerBuyLotTool } from '../buy-lot/buy-lot.js';
import { registerQuoteBuyTool } from '../quote-buy/quote-buy.js';

describe('buy_lot tool', () => {
    it('reports a buy with the clan economics, burn, sale approve and buy tx', async () => {
        const handler = capture(registerBuyLotTool, { trade: { buyLot: async () => buyResult } });
        const result = await handler({ lotId: '7', chain: [], value: '10' } as never);
        expect(result.content[0]?.text).toMatch(/Bought 10 Silica/);
        expect(result.content[0]?.text).toMatch(/sale 5 \$CPU/);
        expect(result.content[0]?.text).toMatch(/0.2 syndicate discount/);
        expect(result.content[0]?.text).toMatch(/4.8 charged/);
        expect(result.content[0]?.text).toMatch(/transit 0.5 \$CPU \(saved 0.1 \$CPU via syndicate\)/);
        expect(result.content[0]?.text).toMatch(/0.03 taxed to the hub's syndicate/);
        expect(result.content[0]?.text).toMatch(/0.095 net to the hub owner/);
        expect(result.content[0]?.text).toMatch(/0.05 was burned/);
        expect(result.content[0]?.text).toMatch(/sale approve 0xapprove/);
        expect(result.content[0]?.text).toMatch(/buy tx 0xbuy/);
        const parsed = JSON.parse(result.content[1]?.text ?? '{}') as { eventType: string };
        expect(parsed.eventType).toBe(ToolEventType.LotBought);
    });

    it('propagates service errors', async () => {
        const handler = capture(registerBuyLotTool, {
            trade: {
                buyLot: async () => {
                    throw new Error('LotNotOpen');
                },
            },
        });
        await expect(handler({ lotId: '7', chain: [], value: '10' } as never)).rejects.toThrow(/LotNotOpen/);
    });
});

describe('quote_buy tool', () => {
    it('summarizes a routed buy quote', async () => {
        const quote: TradeQuote = {
            lotId: '7',
            resourceId: 3,
            pricePerUnit: '0.5',
            value: '100',
            remaining: '80',
            routed: true,
            sale: '50',
            saleFeePercent: 1.5,
            discount: '0',
            salePaid: '50',
            tax: '0',
            ownerNet: '0.75',
            transitFee: '5',
            transitDiscount: '0',
            arrivalAt: 1704,
            total: '55',
        };
        const handler = capture(registerQuoteBuyTool, { trade: { quoteBuy: async () => quote } });
        const result = await handler({ lotId: '7', value: '100', chain: [] } as never);
        expect(result.content[0]?.text).toMatch(/Buy quote for lot 7/);
        expect(result.content[0]?.text).toMatch(/Silica \(#3\)/);
        expect(result.content[0]?.text).toMatch(/55 \$CPU total/);
        expect(result.content[0]?.text).toMatch(/does not check pause, \$CPU balance, or allowance/);
    });

    it('summarizes a seller-only estimate with the sale split', async () => {
        const quote: TradeQuote = {
            lotId: '7',
            resourceId: 3,
            pricePerUnit: '0.5',
            value: '100',
            remaining: '80',
            routed: false,
            sale: '50',
            saleFeePercent: 1.5,
            discount: '2',
            salePaid: '48',
            tax: '0.1',
            ownerNet: '0.65',
            transitFee: null,
            transitDiscount: null,
            arrivalAt: null,
            total: '48',
        };
        const handler = capture(registerQuoteBuyTool, { trade: { quoteBuy: async () => quote } });
        const result = await handler({ lotId: '7', value: '100', chain: null } as never);
        expect(result.content[0]?.text).toMatch(/Seller-only estimate for lot 7/);
        expect(result.content[0]?.text).toMatch(/sale 50 \$CPU \(hub fee 1.5%\) − 2 syndicate discount = 48 charged/);
    });

    it('states the pause/balance/allowance caveat', async () => {
        const quote: TradeQuote = {
            lotId: '7',
            resourceId: 3,
            pricePerUnit: '0.5',
            value: '100',
            remaining: '80',
            routed: false,
            sale: '50',
            saleFeePercent: 6,
            discount: '0',
            salePaid: '50',
            tax: '0',
            ownerNet: '3',
            transitFee: null,
            transitDiscount: null,
            arrivalAt: null,
            total: '50',
        };
        const handler = capture(registerQuoteBuyTool, { trade: { quoteBuy: async () => quote } });
        const result = await handler({ lotId: '7', value: '100', chain: null } as never);
        expect(result.content[0]?.text).toMatch(/does not check pause, \$CPU balance, or allowance/);
    });
});
