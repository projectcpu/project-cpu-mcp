import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { type FillView, type LotView, type MarketResourceSummary, BuildingType, LotState } from '../../../api/types.js';
import { Network } from '../../../config/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { makeCell, projectCell } from '../../../map/__tests__/fixtures.js';
import type { Cell } from '../../../map/types.js';
import type {
    BalanceResult,
    BuyLotResult,
    CancelLotResult,
    CreateLotResult,
    ListFillsQuery,
    SetSaleFeeResult,
    TradeQuote,
} from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { TxStatus } from '../../../wallet/types.js';
import { registerGetBalanceTool } from '../../account/get-balance/get-balance.js';
import type { ToolRegistrar } from '../../types.js';
import { registerBuyLotTool } from '../buy-lot/buy-lot.js';
import { registerCancelLotTool } from '../cancel-lot/cancel-lot.js';
import { registerCreateLotTool } from '../create-lot/create-lot.js';
import { registerGetLotTool } from '../get-lot/get-lot.js';
import { registerListFillsTool } from '../list-fills/list-fills.js';
import { registerListLotsTool } from '../list-lots/list-lots.js';
import { registerListMyLotsTool } from '../list-mine/list-my-lots.js';
import { registerGetMarketsTool } from '../markets/get-markets.js';
import { registerQuoteBuyTool } from '../quote-buy/quote-buy.js';
import { registerSetSaleFeeTool } from '../set-sale-fee/set-sale-fee.js';
import { createLotInputSchema, setSaleFeeInputSchema } from '../types.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Register = (server: ToolRegistrar, context: AppContext) => void;

const RESOURCES = { 3: 'Silica' };

function capture(register: Register, contextPartial: Record<string, unknown>): (args: never) => Promise<ToolResult> {
    const appConfig = { load: async () => ({ resources: RESOURCES }) };
    const context = { appConfig, logger: new NoopLogger(), ...contextPartial } as unknown as AppContext;
    let captured: ((args: never) => Promise<ToolResult>) | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: (args: never) => Promise<ToolResult>): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;
    register(server, context);
    if (captured === null) {
        throw new Error('tool was not registered');
    }
    return captured;
}

const createResult: CreateLotResult = {
    lotId: '7',
    hubTokenId: '20',
    resourceId: 3,
    value: '100',
    pricePerUnit: '0.5',
    maxSaleFeePercent: 2.5,
    deliveryId: '123',
    arrivalAt: 1704,
    fee: '0',
    transitPaid: '0',
    transitDiscount: '0',
    txHash: '0xcreate',
    approveTxHash: null,
    status: TxStatus.Success,
    blockNumber: '100',
};

const cancelResult: CancelLotResult = {
    lotId: '7',
    resourceId: 3,
    returned: '80',
    fee: '0',
    transitPaid: '0',
    transitDiscount: '0',
    deliveryId: '123',
    arrivalAt: 1704,
    txHash: '0xcancel',
    approveTxHash: null,
    status: TxStatus.Success,
    blockNumber: '100',
};

const buyResult: BuyLotResult = {
    lotId: '7',
    resourceId: 3,
    value: '10',
    sale: '5',
    discount: '0.2',
    paid: '4.8',
    hubFee: '0.125',
    tax: '0.03',
    ownerNet: '0.095',
    burn: '0.05',
    remaining: '90',
    fee: '0',
    transitPaid: '0.5',
    transitDiscount: '0.1',
    deliveryId: '123',
    arrivalAt: 1704,
    txHash: '0xbuy',
    approveSaleTxHash: '0xapprove',
    approveTransitTxHash: null,
    status: TxStatus.Success,
    blockNumber: '100',
};

const setFeeResult: SetSaleFeeResult = {
    hubTokenId: '20',
    resourceId: 3,
    feePercent: 2.5,
    txHash: '0xsetfee',
    status: TxStatus.Success,
    blockNumber: '100',
};

const lot: LotView = {
    id: 'lot-1',
    hubTokenId: '5',
    sellerAddress: '0xseller',
    resourceId: 3,
    listed: '100',
    remaining: '80',
    pricePerUnit: '0.5',
    saleFeePercent: 1.5,
    maxSaleFeePercent: 50,
    frozen: false,
    state: LotState.Open,
    distanceFromAnchor: 3,
    createdAt: 1700,
    updated: 1700,
};

const frozenLot: LotView = { ...lot, id: 'lot-frozen', saleFeePercent: 6, maxSaleFeePercent: 5, frozen: true };

const market: MarketResourceSummary = {
    hubTokenId: '5',
    resourceId: 3,
    openLots: 2,
    openRemaining: '150',
    minPricePerUnit: '0.4',
    incomingLots: 1,
    incomingRemaining: '50',
    frozenLots: null,
    frozenRemaining: null,
    distanceFromAnchor: 3,
};

const fill: FillView = {
    lotId: '7',
    blockNumber: 1200,
    logIndex: 4,
    transactionHash: '0xfill',
    hubTokenId: '20',
    resourceId: 3,
    seller: '0xseller',
    buyer: '0xbuyer',
    value: '10',
    remaining: '90',
    sale: '0.4',
    hubFee: '0.01',
    burn: '0.002',
    pricePerUnit: '0.04',
    settledAt: 1700000000,
    soldOut: false,
};

function hubCell(
    saleFeeOverrides: Record<number, number> | null,
    building: Cell['building'] | null = {
        type: BuildingType.Hub,
        buildFinishAt: 0,
        modeResource: null,
        modeRecipeId: null,
    },
): Cell {
    return projectCell(makeCell({ tokenId: '5', building, saleFeeOverrides }));
}

describe('create_lot / cancel_lot tools', () => {
    it('summarizes a create with the locked-in tolerance, delivery and finalize hint', async () => {
        const handler = capture(registerCreateLotTool, { trade: { createLot: async () => createResult } });
        const result = await handler({
            chain: [],
            resourceId: 3,
            value: '100',
            pricePerUnit: '0.5',
            maxSaleFeePercent: null,
        } as never);
        expect(result.content[0]?.text).toMatch(/Listed lot 7/);
        expect(result.content[0]?.text).toMatch(/Silica \(#3\)/);
        expect(result.content[0]?.text).toMatch(/sale-fee tolerance 2.5% locked in/);
        expect(result.content[0]?.text).toMatch(/cancel_lot is always fee-free/);
        expect(result.content[0]?.text).toMatch(/finalize_delivery on 123/);
        expect(result.content[0]?.text).toMatch(/create tx 0xcreate/);
        const json = JSON.parse(result.content[1]?.text ?? '{}') as CreateLotResult;
        expect(json.maxSaleFeePercent).toBe(2.5);
    });

    it('summarizes a cancel with the returned units and finalize hint', async () => {
        const handler = capture(registerCancelLotTool, { trade: { cancelLot: async () => cancelResult } });
        const result = await handler({ lotId: '7', chain: [] } as never);
        expect(result.content[0]?.text).toMatch(/Cancelled lot 7/);
        expect(result.content[0]?.text).toMatch(/finalize_delivery on 123/);
        expect(result.content[0]?.text).toMatch(/cancel tx 0xcancel/);
    });
});

describe('set_sale_fee tool', () => {
    it('reports a confirmed rate change with the tx', async () => {
        const handler = capture(registerSetSaleFeeTool, { trade: { setSaleFee: async () => setFeeResult } });
        const result = await handler({ hubTokenId: 20, resourceId: 3, feePercent: 2.5 } as never);
        expect(result.content[0]?.text).toMatch(/Set the sale fee for Silica \(#3\) on Hub 20 to 2.5%/);
        expect(result.content[0]?.text).toMatch(/tx 0xsetfee/);
        const json = JSON.parse(result.content[1]?.text ?? '{}') as SetSaleFeeResult;
        expect(json.feePercent).toBe(2.5);
    });

    it('propagates validation errors from the service', async () => {
        const handler = capture(registerSetSaleFeeTool, {
            trade: {
                setSaleFee: async () => {
                    throw new Error('Rate 0.005% is finer than 0.01% (one basis point); use a rate on a whole bp.');
                },
            },
        });
        await expect(handler({ hubTokenId: 20, resourceId: 3, feePercent: 0.005 } as never)).rejects.toThrow(
            /basis point/i,
        );
    });
});

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

describe('discovery read tools', () => {
    it('list_lots renders a lot line with its frozen sale fee', async () => {
        const handler = capture(registerListLotsTool, { trade: { listLots: async () => [lot] } });
        const result = await handler({} as never);
        expect(result.content[0]?.text).toMatch(/1 lot/);
        expect(result.content[0]?.text).toMatch(/lot lot-1 \[open\]/);
        expect(result.content[0]?.text).toMatch(/Silica \(#3\)/);
        expect(result.content[0]?.text).toMatch(/80\/100/);
        expect(result.content[0]?.text).toMatch(/sale fee 1.5%/);
    });

    it('get_markets enriches the live sale fee from an active hub with an override', async () => {
        const handler = capture(registerGetMarketsTool, {
            trade: { getMarkets: async () => [market] },
            mapReader: { readRevealCell: async (id: string) => (id === '5' ? hubCell({ 3: 2.5 }) : null) },
        });
        const result = await handler({} as never);
        expect(result.content[0]?.text).toMatch(/Hub 5 · /);
        expect(result.content[0]?.text).toMatch(/2 open/);
        expect(result.content[0]?.text).toMatch(/from 0.4 \$CPU/);
        expect(result.content[0]?.text).toMatch(/sale fee 2.5%/);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<{ liveSaleFeePercent: number | null }>;
        expect(json[0]?.liveSaleFeePercent).toBe(2.5);
    });

    it('get_markets reports an active hub with no override as 0%', async () => {
        const handler = capture(registerGetMarketsTool, {
            trade: { getMarkets: async () => [market] },
            mapReader: { readRevealCell: async () => hubCell({}) },
        });
        const result = await handler({} as never);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<{ liveSaleFeePercent: number | null }>;
        expect(json[0]?.liveSaleFeePercent).toBe(0);
    });

    it('get_markets reports null for a hub still under construction, even with an override set', async () => {
        const handler = capture(registerGetMarketsTool, {
            trade: { getMarkets: async () => [market] },
            mapReader: {
                readRevealCell: async () =>
                    hubCell(
                        { 3: 2.5 },
                        { type: BuildingType.Hub, buildFinishAt: 100, modeResource: null, modeRecipeId: null },
                    ),
            },
        });
        const result = await handler({} as never);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<{ liveSaleFeePercent: number | null }>;
        expect(json[0]?.liveSaleFeePercent).toBeNull();
    });

    it('get_markets reports null for a cell with no hub-kind building at all', async () => {
        const handler = capture(registerGetMarketsTool, {
            trade: { getMarkets: async () => [market] },
            mapReader: { readRevealCell: async () => hubCell(null, null) },
        });
        const result = await handler({} as never);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<{ liveSaleFeePercent: number | null }>;
        expect(json[0]?.liveSaleFeePercent).toBeNull();
    });

    it('get_markets degrades liveSaleFeePercent to null when the map has no read on the hub', async () => {
        const handler = capture(registerGetMarketsTool, {
            trade: { getMarkets: async () => [market] },
            mapReader: { readRevealCell: async () => null },
        });
        const result = await handler({} as never);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<{ liveSaleFeePercent: number | null }>;
        expect(json[0]?.liveSaleFeePercent).toBeNull();
    });

    it('get_lot renders a single lot', async () => {
        const handler = capture(registerGetLotTool, { trade: { getLot: async () => lot } });
        const result = await handler({ lotId: 'lot-1' } as never);
        expect(result.content[0]?.text).toMatch(/lot lot-1 \[open\]/);
    });

    it('get_lot annotates and explains a frozen lot, without hiding it', async () => {
        const handler = capture(registerGetLotTool, { trade: { getLot: async () => frozenLot } });
        const result = await handler({ lotId: 'lot-frozen' } as never);
        expect(result.content[0]?.text).toMatch(/lot lot-frozen/);
        expect(result.content[0]?.text).toMatch(/FROZEN \(live 6% > tolerance 5%\)/);
        expect(result.content[0]?.text).toMatch(/exceeds your tolerance/);
        expect(result.content[0]?.text).toMatch(/cancel the lot \(fee-free/);
        const json = JSON.parse(result.content[1]?.text ?? '{}') as LotView;
        expect(json.frozen).toBe(true);
        expect(json.maxSaleFeePercent).toBe(5);
    });

    it('list_my_lots shows the count and state filter', async () => {
        const handler = capture(registerListMyLotsTool, { trade: { listMyLots: async () => [lot] } });
        const result = await handler({ state: LotState.Open } as never);
        expect(result.content[0]?.text).toMatch(/1 lot\(s\) · state=open/);
    });

    it('list_my_lots marks a frozen lot', async () => {
        const handler = capture(registerListMyLotsTool, { trade: { listMyLots: async () => [frozenLot] } });
        const result = await handler({ state: null } as never);
        expect(result.content[0]?.text).toMatch(/FROZEN/);
    });

    it('list_lots prints the exact price string the service returned, unrounded', async () => {
        const oddPricedLot: LotView = { ...lot, id: 'lot-odd', pricePerUnit: '0.123456789012345678' };
        const handler = capture(registerListLotsTool, { trade: { listLots: async () => [oddPricedLot] } });
        const result = await handler({} as never);
        expect(result.content[0]?.text.includes('0.123456789012345678')).toBe(true);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<LotView>;
        expect(json[0]?.pricePerUnit).toBe('0.123456789012345678');
    });

    it('get_markets prints the exact minPrice string the service returned, unrounded', async () => {
        const oddPricedMarket: MarketResourceSummary = { ...market, minPricePerUnit: '0.123456789012345678' };
        const handler = capture(registerGetMarketsTool, {
            trade: { getMarkets: async () => [oddPricedMarket] },
            mapReader: { readRevealCell: async () => null },
        });
        const result = await handler({} as never);
        expect(result.content[0]?.text.includes('0.123456789012345678')).toBe(true);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<{ minPricePerUnit: string | null }>;
        expect(json[0]?.minPricePerUnit).toBe('0.123456789012345678');
    });

    it('get_markets surfaces the frozen aggregate when the server serves it', async () => {
        const frozenMarket: MarketResourceSummary = { ...market, frozenLots: 1, frozenRemaining: '40' };
        const handler = capture(registerGetMarketsTool, {
            trade: { getMarkets: async () => [frozenMarket] },
            mapReader: { readRevealCell: async () => hubCell({ 3: 2.5 }) },
        });
        const result = await handler({} as never);
        expect(result.content[0]?.text).toMatch(/1 frozen \(40\)/);
    });
});

describe('list_fills tool', () => {
    it('hands every input to the service untouched — the cursor above all', async () => {
        const seen: Array<ListFillsQuery> = [];
        const handler = capture(registerListFillsTool, {
            trade: {
                listFills: async (query: ListFillsQuery) => {
                    seen.push(query);
                    return [fill];
                },
            },
        });

        await handler({ resourceId: 3, hubTokenId: 20, before: '1200:4', limit: 25 } as never);

        expect(seen).toHaveLength(1);
        expect(seen[0]).toEqual({ resourceId: 3, hubTokenId: 20, before: '1200:4', limit: 25 });
    });

    it('names the resource and prints the settle time in human form', async () => {
        const handler = capture(registerListFillsTool, { trade: { listFills: async () => [fill] } });
        const result = await handler({} as never);
        expect(result.content[0]?.text).toMatch(/1 fill/);
        expect(result.content[0]?.text).toMatch(/Silica \(#3\)/);
        expect(result.content[0]?.text).toMatch(/2023-11-14 22:13:20 UTC/);
    });

    it('flags a fill that bought out the lot and leaves a partial one unflagged', async () => {
        const handler = capture(registerListFillsTool, {
            trade: { listFills: async () => [{ ...fill, remaining: '0', soldOut: true }, fill] },
        });
        const result = await handler({} as never);
        const [soldOutLine, partialLine] = (result.content[0]?.text ?? '').split('\n').slice(1);
        expect(soldOutLine).toMatch(/SOLD OUT/);
        expect(partialLine).not.toMatch(/SOLD OUT/);
    });

    it('prints the exact money strings the service returned, unrounded', async () => {
        const oddFill: FillView = {
            ...fill,
            sale: '0.123456789012345678',
            pricePerUnit: '0.012345678901234567',
            hubFee: '0.003456789012345671',
            burn: '0.000456789012345672',
        };
        const handler = capture(registerListFillsTool, { trade: { listFills: async () => [oddFill] } });
        const result = await handler({} as never);
        const text = result.content[0]?.text ?? '';
        expect(text.includes('0.123456789012345678')).toBe(true);
        expect(text.includes('0.012345678901234567')).toBe(true);
        expect(text.includes('hub fee 0.003456789012345671')).toBe(true);
        expect(text.includes('burned 0.000456789012345672')).toBe(true);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<FillView>;
        expect(json[0]?.sale).toBe('0.123456789012345678');
        expect(json[0]?.pricePerUnit).toBe('0.012345678901234567');
        expect(json[0]?.hubFee).toBe('0.003456789012345671');
        expect(json[0]?.burn).toBe('0.000456789012345672');
    });

    it('carries the full field set in the JSON block', async () => {
        const handler = capture(registerListFillsTool, { trade: { listFills: async () => [fill] } });
        const result = await handler({} as never);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<FillView>;
        expect(json[0]).toEqual(fill);
    });

    it('keeps the rows in the order the service returned them', async () => {
        const rows: Array<FillView> = [
            { ...fill, blockNumber: 1200, logIndex: 4 },
            { ...fill, blockNumber: 1199, logIndex: 9 },
            { ...fill, blockNumber: 1100, logIndex: 0 },
        ];
        const handler = capture(registerListFillsTool, { trade: { listFills: async () => rows } });
        const result = await handler({} as never);
        const cursors = (result.content[0]?.text ?? '').split('\n').slice(1);
        expect(cursors.map((line) => line.split(' ')[1])).toEqual(['1200:4', '1199:9', '1100:0']);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<FillView>;
        expect(json.map((row) => `${row.blockNumber}:${row.logIndex}`)).toEqual(['1200:4', '1199:9', '1100:0']);
    });

    it('says so plainly when the page is empty', async () => {
        const handler = capture(registerListFillsTool, { trade: { listFills: async () => [] } });
        const result = await handler({} as never);
        expect(result.content[0]?.text).toMatch(/0 fill\(s\)/);
        expect(result.content[1]?.text).toBe('[]');
    });
});

describe('trade percent input caps', () => {
    it('create_lot maxSaleFeePercent accepts 0–100 and rejects above 100', () => {
        const schema = z.object({ maxSaleFeePercent: createLotInputSchema.maxSaleFeePercent });
        expect(schema.safeParse({ maxSaleFeePercent: 0 }).success).toBe(true);
        expect(schema.safeParse({ maxSaleFeePercent: 100 }).success).toBe(true);
        expect(schema.safeParse({ maxSaleFeePercent: 100.1 }).success).toBe(false);
    });

    it('set_sale_fee feePercent accepts 0–100 and rejects above 100', () => {
        const schema = z.object({ feePercent: setSaleFeeInputSchema.feePercent });
        expect(schema.safeParse({ feePercent: 0 }).success).toBe(true);
        expect(schema.safeParse({ feePercent: 100 }).success).toBe(true);
        expect(schema.safeParse({ feePercent: 101 }).success).toBe(false);
    });
});

describe('get_balance tool', () => {
    it('reports $CPU and gas', async () => {
        const balance: BalanceResult = {
            address: '0xdead',
            network: Network.ETHEREUM,
            chainId: 1,
            cpu: '12.5',
            native: '0.3',
        };
        const handler = capture(registerGetBalanceTool, { balance: { getBalances: async () => balance } });
        const result = await handler({} as never);
        expect(result.content[0]?.text).toMatch(/Wallet 0xdead/);
        expect(result.content[0]?.text).toMatch(/12.5 \$CPU/);
        expect(result.content[0]?.text).toMatch(/0.3 gas/);
    });
});
