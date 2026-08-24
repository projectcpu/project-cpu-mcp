import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { capture, createResult, type Register, type ToolResult } from './fixtures.js';
import type { CreateLotResult, LotTermsResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { ToolEventType, type ToolRegistrar } from '../../types.js';
import { CREATE_LOT_DESCRIPTION } from '../create-lot/constants.js';
import { registerCreateLotTool } from '../create-lot/create-lot.js';
import { createLotInputSchema } from '../types.js';

const CREATE_ARGS = {
    chain: [11, 12, 20],
    resourceId: 3,
    value: '100',
    pricePerUnit: '0.5',
    maxSaleFeePercent: null,
};

const allowedTerms: LotTermsResult = {
    hubTokenId: '20',
    resourceId: 3,
    sellerAddress: '0xseller',
    effectiveMin: '100',
    effectiveMax: '400',
    sellerLotCount: 0,
    sellerLotLimit: 3,
    outstandingEvictedCount: 0,
    canList: true,
    blockers: [],
};

interface Harness {
    handler: (args: never) => Promise<ToolResult>;
    steps: Array<string>;
    preflighted: Array<unknown>;
}

/** `refusal` stands for a listing the live terms already refuse: nothing may reach the chain after it. */
function createLotHarness(refusal: Error | null = null): Harness {
    const steps: Array<string> = [];
    const preflighted: Array<unknown> = [];
    const lotTerms = {
        async getLotTerms(): Promise<LotTermsResult> {
            return allowedTerms;
        },
        async assertListingAllowed(input: unknown): Promise<LotTermsResult> {
            steps.push('preflight');
            preflighted.push(input);
            if (refusal !== null) {
                throw refusal;
            }
            return allowedTerms;
        },
    };
    const trade = {
        createLot: async (): Promise<CreateLotResult> => {
            steps.push('createLot');
            return createResult;
        },
    };
    const register: Register = (server: ToolRegistrar, context: AppContext) =>
        registerCreateLotTool(server, context, lotTerms);
    return { handler: capture(register, { trade }), steps, preflighted };
}

describe('create_lot tool', () => {
    it('summarizes a create with the locked-in tolerance, delivery and finalize hint', async () => {
        const result = await createLotHarness().handler(CREATE_ARGS as never);
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
        const created = await createLotHarness().handler(CREATE_ARGS as never);
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
        expect(CREATE_LOT_DESCRIPTION).not.toMatch(/fee-free/);
        expect(CREATE_LOT_DESCRIPTION).not.toMatch(/cpu_cancel_lot/);
        expect(CREATE_LOT_DESCRIPTION).toMatch(/remainder/i);
    });

    it('checks the live terms before it lets anything reach the chain', async () => {
        const harness = createLotHarness();

        await harness.handler(CREATE_ARGS as never);

        expect(harness.steps).toEqual(['preflight', 'createLot']);
    });

    it('sends nothing to the chain when the live terms already refuse the listing', async () => {
        const harness = createLotHarness(new Error('101 units is above the live maximum of 100 units'));

        await expect(harness.handler(CREATE_ARGS as never)).rejects.toThrow(/above the live maximum/);

        expect(harness.steps).toEqual(['preflight']);
    });

    it('preflights the listing hub — the last node of the route — with the amounts as asked', async () => {
        const harness = createLotHarness();

        await harness.handler(CREATE_ARGS as never);

        expect(harness.preflighted).toEqual([
            {
                hubTokenId: '20',
                resourceId: 3,
                value: '100',
                pricePerUnit: '0.5',
                maxSaleFeePercent: null,
            },
        ]);
    });
});
