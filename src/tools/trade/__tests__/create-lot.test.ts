import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { capture, createResult } from './fixtures.js';
import type { CreateLotResult } from '../../../services/types.js';
import { ToolEventType } from '../../types.js';
import { registerCreateLotTool } from '../create-lot/create-lot.js';
import { createLotInputSchema } from '../types.js';

const CREATE_ARGS = {
    chain: [],
    resourceId: 3,
    value: '100',
    pricePerUnit: '0.5',
    maxSaleFeePercent: null,
};

describe('create_lot tool', () => {
    it('summarizes a create with the locked-in tolerance, delivery and finalize hint', async () => {
        const handler = capture(registerCreateLotTool, { trade: { createLot: async () => createResult } });
        const result = await handler(CREATE_ARGS as never);
        expect(result.content[0]?.text).toMatch(/Listed lot 7/);
        expect(result.content[0]?.text).toMatch(/Silica \(#3\)/);
        expect(result.content[0]?.text).toMatch(/sale-fee tolerance 2.5% locked in/);
        expect(result.content[0]?.text).toMatch(/send the remainder home at any time, paying no sale fee/);
        expect(result.content[0]?.text).toMatch(/finalize_delivery on 123/);
        expect(result.content[0]?.text).toMatch(/create tx 0xcreate/);
        const json = JSON.parse(result.content[1]?.text ?? '{}') as CreateLotResult;
        expect(json.maxSaleFeePercent).toBe(2.5);
    });

    it('names the event in the machine block', async () => {
        const handler = capture(registerCreateLotTool, { trade: { createLot: async () => createResult } });
        const created = await handler(CREATE_ARGS as never);
        expect((JSON.parse(created.content[1]?.text ?? '{}') as { eventType: string }).eventType).toBe(
            ToolEventType.LotCreated,
        );
    });

    it('maxSaleFeePercent accepts 0–100 and rejects above 100', () => {
        const schema = z.object({ maxSaleFeePercent: createLotInputSchema.maxSaleFeePercent });
        expect(schema.safeParse({ maxSaleFeePercent: 0 }).success).toBe(true);
        expect(schema.safeParse({ maxSaleFeePercent: 100 }).success).toBe(true);
        expect(schema.safeParse({ maxSaleFeePercent: 100.1 }).success).toBe(false);
    });

    it('never claims a return home is free of every fee', () => {
        expect(createLotInputSchema.maxSaleFeePercent.description).not.toMatch(/fee-free/);
    });
});
