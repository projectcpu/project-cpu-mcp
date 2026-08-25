import { describe, expect, it } from 'vitest';

import { captureTool, type CapturedTool } from './fixtures.js';
import { LotState } from '../../../api/types.js';
import { LotReturnBranch, type LotReturnQuote, type LotReturnResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { TxStatus } from '../../../wallet/types.js';
import { ToolEventType, type ToolRegistrar } from '../../types.js';
import { registerQuoteLotReturnTool } from '../quote-lot-return/quote-lot-return.js';
import { registerReturnLotTool } from '../return-lot/return-lot.js';

const quote: LotReturnQuote = {
    lotId: '7',
    hubTokenId: '20',
    resourceId: 3,
    amount: '80',
    destinationTokenId: '31',
    maxTransitFee: '0.7',
    maxTransitFeeWei: '700000000000000000',
    transitDiscount: '0.2',
    totalDistance: 4,
    arrivalAt: 1_700_000_900,
    capacity: { fits: true, required: '80', free: '120' },
};

const result: LotReturnResult = {
    lotId: '7',
    originalState: LotState.Open,
    branch: LotReturnBranch.Cancelled,
    hubTokenId: '20',
    resourceId: 3,
    returned: '80',
    transitPaid: '0.7',
    transitDiscount: '0.2',
    destinationTokenId: '31',
    deliveryId: '123',
    arrivalAt: 1_700_000_900,
    approveTxHash: '0xapprove',
    txHash: '0xreturn',
    status: TxStatus.Success,
    blockNumber: '100',
};

function quoteTool(over: Partial<LotReturnQuote> = {}): CapturedTool {
    const service = { quoteReturn: async () => ({ ...quote, ...over }) };
    return captureTool(
        (server: ToolRegistrar, context: AppContext) => registerQuoteLotReturnTool(server, context, service),
        {},
    );
}

function returnTool(over: Partial<LotReturnResult> = {}): CapturedTool {
    const service = { returnLot: async () => ({ ...result, ...over }) };
    return captureTool(
        (server: ToolRegistrar, context: AppContext) => registerReturnLotTool(server, context, service),
        {},
    );
}

describe('quote_lot_return tool', () => {
    it('registers under the lot-return quote name and says a session is required', () => {
        const tool = quoteTool();
        expect(tool.name).toBe('cpu_quote_lot_return');
        expect(tool.description).toMatch(/session/i);
    });

    it('asks for one lot and one explicit full route', () => {
        const tool = quoteTool();
        expect(Object.keys(tool.inputSchema).sort()).toEqual(['chain', 'lotId']);
        expect(tool.inputSchema.chain?.safeParse([20]).success).toBe(false);
        expect(tool.inputSchema.chain?.safeParse([20, 31]).success).toBe(true);
    });

    it('hands back the wei ceiling to pass on, and says what passing it does', async () => {
        const out = await quoteTool().handler({ lotId: '7', chain: [20, 31] } as never);
        const text = out.content[0]?.text ?? '';
        expect(text).toContain('maxTransitFeeWei=700000000000000000');
        expect(text).toMatch(/refuses rather than pay more/i);
    });

    it('states the whole remainder, the destination, the fee, the discount, the distance and the ETA', async () => {
        const tool = quoteTool();
        const out = await tool.handler({ lotId: '7', chain: [20, 31] } as never);
        const text = out.content[0]?.text ?? '';
        expect(text).toMatch(/whole remainder/i);
        expect(text).toMatch(/80 Silica/);
        expect(text).toMatch(/cell 31/i);
        expect(text).toMatch(/0\.7 \$CPU/);
        expect(text).toMatch(/0\.2/);
        expect(text).toMatch(/4 grid steps/i);
    });

    it('says the destination has room, with the free figure it checked', async () => {
        const out = await quoteTool().handler({ lotId: '7', chain: [20, 31] } as never);
        expect(out.content[0]?.text).toMatch(/120 free/i);
    });

    it('says outright when the whole remainder does not fit, naming required and free', async () => {
        const tool = quoteTool({ capacity: { fits: false, required: '80', free: '40' } });
        const out = await tool.handler({ lotId: '7', chain: [20, 31] } as never);
        const text = out.content[0]?.text ?? '';
        expect(text).toMatch(/does not fit/i);
        expect(text).toMatch(/80/);
        expect(text).toMatch(/40/);
    });

    it('never claims a free figure for uncapped destination storage', async () => {
        const tool = quoteTool({ capacity: { fits: true, required: '80', free: null } });
        const out = await tool.handler({ lotId: '7', chain: [20, 31] } as never);
        expect(out.content[0]?.text).toMatch(/uncapped/i);
    });

    it('carries the quote unchanged in the machine block', async () => {
        const out = await quoteTool().handler({ lotId: '7', chain: [20, 31] } as never);
        expect(JSON.parse(out.content[1]?.text ?? '{}')).toEqual(quote);
    });
});

describe('return_lot tool', () => {
    it('registers under the lot-return name and says a session is required', () => {
        const tool = returnTool();
        expect(tool.name).toBe('cpu_return_lot');
        expect(tool.description).toMatch(/session/i);
    });

    it('reads the same lot and explicit full route as the quote, plus a required fee ceiling', () => {
        const schema = returnTool().inputSchema;
        expect(Object.keys(schema).sort()).toEqual(['chain', 'lotId', 'maxTransitFeeWei']);
        expect(schema.maxTransitFeeWei?.safeParse(undefined).success).toBe(false);
        expect(schema.maxTransitFeeWei?.safeParse('700000000000000000').success).toBe(true);
        expect(schema.maxTransitFeeWei?.safeParse('0.7').success).toBe(false);
    });

    it('tells the caller where the ceiling comes from and that a stale one is refused', () => {
        const schema = returnTool().inputSchema;
        const description = schema.maxTransitFeeWei?.description ?? '';
        expect(description).toMatch(/cpu_quote_lot_return/);
        expect(description).toMatch(/wei/i);
        expect(description).toMatch(/refused/i);
    });

    // Two different mechanisms, and an earlier revision collapsed them into one: the source hub's RATE is
    // pinned at listing, while the ceiling caps the route TOTAL on-chain. Saying only the first hop is capped
    // denies the backstop the seller's figure actually buys, so pin both halves.
    it('separates the source-hub rate pinned at listing from the ceiling that caps the whole route on-chain', () => {
        const schema = returnTool().inputSchema;
        const description = schema.maxTransitFeeWei?.description ?? '';
        expect(description).toContain('Only the source hub charges the rate pinned when the lot was listed');
        expect(description).toContain('every later waypoint on the way home can raise its own rate');
        expect(description).toContain('a cap on the whole route total');
        expect(description).toContain('the chain refuses it too');
        expect(description).not.toMatch(/only the first hop/i);
        expect(description).not.toContain('is capped on-chain, so any later waypoint can raise its rate');
    });

    it('carries the ceiling the caller passed through to the service', async () => {
        const seen: Array<unknown> = [];
        const service = {
            returnLot: async (args: unknown) => {
                seen.push(args);
                return result;
            },
        };
        const tool = captureTool(
            (server: ToolRegistrar, context: AppContext) => registerReturnLotTool(server, context, service),
            {},
        );
        await tool.handler({ lotId: '7', chain: [20, 31], maxTransitFeeWei: '700000000000000000' } as never);
        expect(seen[0]).toEqual({ lotId: '7', chain: [20, 31], maxTransitFeeWei: '700000000000000000' });
    });

    it('summarizes a cancelled Open lot with the units, the delivery and the fee', async () => {
        const out = await returnTool().handler({ lotId: '7', chain: [20, 31] } as never);
        const text = out.content[0]?.text ?? '';
        expect(text).toMatch(/lot 7/i);
        expect(text).toMatch(/80 Silica/);
        expect(text).toMatch(/cancel/i);
        expect(text).toMatch(/finalize_delivery on 123/);
        expect(text).toMatch(/0\.7 \$CPU/);
        expect(text).toMatch(/approve tx 0xapprove/);
        expect(text).toMatch(/0xreturn/);
    });

    it('names the reclaim branch when the lot was evicted rather than open', async () => {
        const tool = returnTool({ originalState: LotState.Evicted, branch: LotReturnBranch.Reclaimed });
        const out = await tool.handler({ lotId: '7', chain: [20, 31] } as never);
        expect(out.content[0]?.text).toMatch(/evicted/i);
        expect(out.content[0]?.text).toMatch(/reclaim/i);
    });

    it('warns that handing the destination cell on before finalization hands the goods on with it', async () => {
        const out = await returnTool().handler({ lotId: '7', chain: [20, 31] } as never);
        const text = out.content[0]?.text ?? '';
        expect(text).toMatch(/transfer/i);
        expect(text).toMatch(/new owner/i);
    });

    it('names the event in the machine block', async () => {
        const out = await returnTool().handler({ lotId: '7', chain: [20, 31] } as never);
        expect((JSON.parse(out.content[1]?.text ?? '{}') as { eventType: string }).eventType).toBe(
            ToolEventType.LotReturned,
        );
    });
});
