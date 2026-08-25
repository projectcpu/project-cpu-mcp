import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { captureTool, type Register, type ToolResult } from './fixtures.js';
import { LotListingBlocker, type LotTermsResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerGetLotTermsTool } from '../lot-terms/lot-terms.js';

const clearTerms: LotTermsResult = {
    hubTokenId: '20',
    resourceId: 3,
    sellerAddress: '0xseller',
    effectiveMin: '100',
    effectiveMax: '400',
    sellerLotCount: 1,
    sellerLotLimit: 3,
    outstandingEvictedCount: 0,
    canList: true,
    blockers: [],
};

const blockedTerms: LotTermsResult = {
    ...clearTerms,
    sellerLotCount: 3,
    outstandingEvictedCount: 2,
    canList: false,
    blockers: [LotListingBlocker.EvictedPending, LotListingBlocker.SellerLotLimit],
};

function lotTermsTool(terms: LotTermsResult): {
    handler: (args: never) => Promise<ToolResult>;
    asked: Array<{ hubTokenId: string; resourceId: number }>;
    name: string;
    description: string;
    inputSchema: Record<string, z.ZodTypeAny>;
} {
    const asked: Array<{ hubTokenId: string; resourceId: number }> = [];
    const lotTerms = {
        async getLotTerms(input: { hubTokenId: string; resourceId: number }): Promise<LotTermsResult> {
            asked.push(input);
            return terms;
        },
        async assertListingAllowed(): Promise<LotTermsResult> {
            return terms;
        },
    };
    const register: Register = (server: ToolRegistrar, context: AppContext) =>
        registerGetLotTermsTool(server, context, lotTerms);
    const captured = captureTool(register, {});
    return {
        handler: captured.handler,
        asked,
        name: captured.name,
        description: captured.description,
        inputSchema: captured.inputSchema as Record<string, z.ZodTypeAny>,
    };
}

describe('get_lot_terms tool', () => {
    it('registers under its public name and asks for one hub and one resource', () => {
        const tool = lotTermsTool(clearTerms);

        expect(tool.name).toBe('cpu_get_lot_terms');
        expect(Object.keys(tool.inputSchema).sort()).toEqual(['hubTokenId', 'resourceId']);
        const schema = z.object(tool.inputSchema);
        expect(schema.safeParse({ hubTokenId: 20, resourceId: 3 }).success).toBe(true);
        expect(schema.safeParse({ resourceId: 3 }).success).toBe(false);
    });

    it('passes the hub and resource through to the terms read', async () => {
        const tool = lotTermsTool(clearTerms);

        await tool.handler({ hubTokenId: 20, resourceId: 3 } as never);

        expect(tool.asked).toEqual([{ hubTokenId: '20', resourceId: 3 }]);
    });

    it('reports the live window, the seller slots and the evicted debt, and says it can list', async () => {
        const tool = lotTermsTool(clearTerms);

        const result = await tool.handler({ hubTokenId: 20, resourceId: 3 } as never);
        const text = result.content[0]?.text ?? '';

        expect(text).toMatch(/hub 20/i);
        expect(text).toMatch(/Silica \(#3\)/);
        expect(text).toMatch(/100 .. 400 units|100–400 units|between 100 and 400 units/);
        expect(text).toMatch(/1 of 3 live lots/);
        expect(text).toMatch(/no evicted/i);
        expect(text).toMatch(/can list/i);
        expect(JSON.parse(result.content[1]?.text ?? '{}')).toEqual(clearTerms);
    });

    it('spells out every blocker with the action that clears it', async () => {
        const tool = lotTermsTool(blockedTerms);

        const text = (await tool.handler({ hubTokenId: 20, resourceId: 3 } as never)).content[0]?.text ?? '';

        expect(text).toMatch(/cannot list/i);
        expect(text).toMatch(/2 evicted/);
        expect(text).toMatch(/3 of 3 live lots/);
        expect(text).toMatch(/return/i);
    });

    it('hands the refusal to the machine block with every blocker behind it', async () => {
        const tool = lotTermsTool(blockedTerms);

        const result = await tool.handler({ hubTokenId: 20, resourceId: 3 } as never);
        const machine = JSON.parse(result.content[1]?.text ?? '{}');

        expect(machine).toEqual(blockedTerms);
        expect(machine.canList).toBe(false);
        expect(machine.blockers).toEqual([LotListingBlocker.EvictedPending, LotListingBlocker.SellerLotLimit]);
    });

    it('says the window comes from the contract, never from the configured shares', () => {
        expect(lotTermsTool(clearTerms).description).toMatch(/live|effective/i);
        expect(lotTermsTool(clearTerms).description).not.toMatch(/share/i);
    });
});
