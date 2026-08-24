import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { capture, setFeeResult } from './fixtures.js';
import type { SetSaleFeeResult } from '../../../services/types.js';
import { ToolEventType } from '../../types.js';
import { registerSetSaleFeeTool } from '../set-sale-fee/set-sale-fee.js';
import { setSaleFeeInputSchema } from '../types.js';

describe('set_sale_fee tool', () => {
    it('reports a confirmed rate change with the tx', async () => {
        const handler = capture(registerSetSaleFeeTool, { trade: { setSaleFee: async () => setFeeResult } });
        const result = await handler({ hubTokenId: 20, resourceId: 3, feePercent: 2.5 } as never);
        expect(result.content[0]?.text).toMatch(/Set the sale fee for Silica \(#3\) on Hub 20 to 2.5%/);
        expect(result.content[0]?.text).toMatch(/tx 0xsetfee/);
        const json = JSON.parse(result.content[1]?.text ?? '{}') as SetSaleFeeResult;
        expect(json.feePercent).toBe(2.5);
        const parsed = JSON.parse(result.content[1]?.text ?? '{}') as { eventType: string };
        expect(parsed.eventType).toBe(ToolEventType.HubFeeSet);
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

    it('feePercent accepts 0–100 and rejects above 100', () => {
        const schema = z.object({ feePercent: setSaleFeeInputSchema.feePercent });
        expect(schema.safeParse({ feePercent: 0 }).success).toBe(true);
        expect(schema.safeParse({ feePercent: 100 }).success).toBe(true);
        expect(schema.safeParse({ feePercent: 101 }).success).toBe(false);
    });
});
