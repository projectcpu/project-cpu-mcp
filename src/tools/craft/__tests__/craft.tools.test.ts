import { describe, expect, it } from 'vitest';

import { CraftRecipeId, type RecipeView } from '../../../api/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import {
    type CraftClaimResult,
    type CraftStartResult,
    type CraftStatusResult,
    ModeCostKind,
    ModeFreeReason,
} from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { TxStatus } from '../../../wallet/types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerClaimCraftTool } from '../claim/claim-craft.js';
import { registerCraftTool } from '../craft.js';
import { registerGetCraftStatusTool } from '../get-status/get-craft-status.js';
import { registerListRecipesTool } from '../list-recipes/list-recipes.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Handler = (args: Record<string, unknown>) => Promise<ToolResult>;

const STEEL_RECIPE: RecipeView = {
    id: CraftRecipeId.SmeltSteel,
    name: 'Smelt Steel',
    tier: 2,
    inputs: [{ resourceId: 5, amount: 4 }],
    outputs: [{ resourceId: 102, amount: 2 }],
    durationSec: 30,
    costCpu: '0',
};
const FORGE_RECIPE: RecipeView = {
    id: CraftRecipeId.ForgeWcpu,
    name: 'CPU Forge',
    tier: 5,
    inputs: [{ resourceId: 100, amount: 50 }],
    outputs: [{ resourceId: 1, amount: 1 }],
    durationSec: 3600,
    costCpu: '100',
};

const appConfigStub = {
    load: async (): Promise<{ resources: Record<number, string>; recipes: Array<RecipeView> }> => ({
        resources: { 1: 'WCPU', 5: 'Iron', 100: 'Energy', 102: 'Steel' },
        recipes: [STEEL_RECIPE, FORGE_RECIPE],
    }),
};

function capture(register: (server: ToolRegistrar, context: AppContext) => void, context: AppContext): Handler {
    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;
    register(server, context);
    if (captured === null) {
        throw new Error('tool was not registered');
    }
    return captured;
}

function craftHarness(outcome: CraftStartResult): Handler {
    const craft = { craft: async (): Promise<CraftStartResult> => outcome };
    const context = { craft, appConfig: appConfigStub, logger: new NoopLogger() } as unknown as AppContext;
    return capture(registerCraftTool, context);
}

describe('craft tool', () => {
    it('summarizes a free craft', async () => {
        const result = await craftHarness({
            tokenId: '42',
            recipeId: CraftRecipeId.SmeltSteel,
            batches: 2,
            costCpu: '0',
            opex: { served: true, costCpu: '0' },
            totalCpu: '0',
            modeSwitch: {
                cost: { kind: ModeCostKind.Free, why: ModeFreeReason.FirstPick },
                exact: true,
                burnedCpu: '0',
            },
            approveTxHash: null,
            txHash: `0x${'1'.repeat(64)}`,
            status: TxStatus.Success,
            blockNumber: '100',
        })({ tokenId: '42', recipeId: CraftRecipeId.SmeltSteel, batches: 2 });

        const header = result.content[0]?.text ?? '';
        expect(header).toMatch(/Craft started/i);
        expect(header).toMatch(/2× smelt_steel \(free\)/);
        expect(header).toMatch(/claim_craft 42/);
    });

    it('summarizes a paid craft with the $CPU cost and approve tx', async () => {
        const result = await craftHarness({
            tokenId: '42',
            recipeId: CraftRecipeId.ForgeWcpu,
            batches: 1,
            costCpu: '100',
            opex: { served: true, costCpu: '0' },
            totalCpu: '100',
            modeSwitch: {
                cost: { kind: ModeCostKind.Free, why: ModeFreeReason.FirstPick },
                exact: true,
                burnedCpu: '0',
            },
            approveTxHash: `0x${'c'.repeat(64)}`,
            txHash: `0x${'1'.repeat(64)}`,
            status: TxStatus.Success,
            blockNumber: '100',
        })({ tokenId: '42', recipeId: CraftRecipeId.ForgeWcpu, batches: 1 });

        const header = result.content[0]?.text ?? '';
        expect(header).toMatch(/100 \$CPU/);
        expect(header).toMatch(/approve tx/);
        expect(header).toMatch(/get_craft_status 42/);
    });

    it('reports the base and opex breakdown when the server serves opex', async () => {
        const result = await craftHarness({
            tokenId: '42',
            recipeId: CraftRecipeId.ForgeWcpu,
            batches: 2,
            costCpu: '200',
            opex: { served: true, costCpu: '20' },
            totalCpu: '220',
            modeSwitch: {
                cost: { kind: ModeCostKind.Free, why: ModeFreeReason.FirstPick },
                exact: true,
                burnedCpu: '0',
            },
            approveTxHash: `0x${'c'.repeat(64)}`,
            txHash: `0x${'1'.repeat(64)}`,
            status: TxStatus.Success,
            blockNumber: '100',
        })({ tokenId: '42', recipeId: CraftRecipeId.ForgeWcpu, batches: 2 });

        const header = result.content[0]?.text ?? '';
        expect(header).toMatch(/200 \$CPU base \+ 20 \$CPU opex = 220 \$CPU/);
    });

    it('carries the explicit opex disclaimer when the server does not serve it', async () => {
        const result = await craftHarness({
            tokenId: '42',
            recipeId: CraftRecipeId.ForgeWcpu,
            batches: 1,
            costCpu: '100',
            opex: { served: false, costCpu: '0' },
            totalCpu: '100',
            modeSwitch: {
                cost: { kind: ModeCostKind.Free, why: ModeFreeReason.FirstPick },
                exact: true,
                burnedCpu: '0',
            },
            approveTxHash: `0x${'c'.repeat(64)}`,
            txHash: `0x${'1'.repeat(64)}`,
            status: TxStatus.Success,
            blockNumber: '100',
        })({ tokenId: '42', recipeId: CraftRecipeId.ForgeWcpu, batches: 1 });

        const header = result.content[0]?.text ?? '';
        expect(header).toMatch(/100 \$CPU, plus a per-recipe opex the chain adds on top \(not priced here\)/);
    });

    it('propagates service errors', async () => {
        const craft = {
            craft: async (): Promise<CraftStartResult> => {
                throw new Error('craftRejected');
            },
        };
        const context = { craft, appConfig: appConfigStub, logger: new NoopLogger() } as unknown as AppContext;
        const handler = capture(registerCraftTool, context);
        await expect(handler({ tokenId: '42', recipeId: CraftRecipeId.SmeltSteel, batches: 1 })).rejects.toThrow(
            /craftRejected/,
        );
    });
});

describe('list_recipes tool', () => {
    it('lists each recipe with inputs, outputs, duration and cost', async () => {
        const context = { appConfig: appConfigStub, logger: new NoopLogger() } as unknown as AppContext;
        const handler = capture(registerListRecipesTool, context);

        const result = await handler({});
        const header = result.content[0]?.text ?? '';
        expect(header).toMatch(
            /Smelt Steel \(smelt_steel\): 4 Iron \(#5\) → 2 Steel \(#102\), ~30 seconds\/batch, free/,
        );
        expect(header).toMatch(/CPU Forge \(forge_wcpu\):.*~1 hour\/batch, 100 \$CPU\/batch/);
    });
});

describe('get_craft_status tool', () => {
    it('summarizes an active process with claimable batches', async () => {
        const status: CraftStatusResult = {
            tokenId: '42',
            active: true,
            serverTime: 1040,
            recipeId: CraftRecipeId.SmeltSteel,
            batches: 2,
            claimedBatches: 0,
            completedBatches: 1,
            claimableBatches: 1,
            isFinished: false,
            startAt: 1000,
            durationSec: 30,
            endsAtSec: 1060,
            nextBatchAtSec: 1060,
            stalled: false,
            blockedResourceIds: [],
        };
        const craft = { getStatus: async (): Promise<CraftStatusResult> => status };
        const context = { craft, appConfig: appConfigStub, logger: new NoopLogger() } as unknown as AppContext;
        const handler = capture(registerGetCraftStatusTool, context);

        const result = await handler({ tokenId: '42' });
        const header = result.content[0]?.text ?? '';
        expect(header).toMatch(/1\/2 batches done/);
        expect(header).toMatch(/1 claimable now/);
    });

    it('reports a cell with no active craft', async () => {
        const status: CraftStatusResult = {
            tokenId: '42',
            active: false,
            serverTime: 1000,
            recipeId: null,
            batches: 0,
            claimedBatches: 0,
            completedBatches: 0,
            claimableBatches: 0,
            isFinished: false,
            startAt: null,
            durationSec: null,
            endsAtSec: null,
            nextBatchAtSec: null,
            stalled: false,
            blockedResourceIds: [],
        };
        const craft = { getStatus: async (): Promise<CraftStatusResult> => status };
        const context = { craft, appConfig: appConfigStub, logger: new NoopLogger() } as unknown as AppContext;
        const handler = capture(registerGetCraftStatusTool, context);

        const result = await handler({ tokenId: '42' });
        expect(result.content[0]?.text).toMatch(/no active craft/i);
    });
});

describe('claim_craft tool', () => {
    it('reports the claimed resources', async () => {
        const claim: CraftClaimResult = {
            tokenId: '42',
            recipeId: CraftRecipeId.SmeltSteel,
            batches: 1,
            claimedBatches: 1,
            outputs: [{ resourceId: 102, amount: '20' }],
            txHash: `0x${'1'.repeat(64)}`,
            status: TxStatus.Success,
            blockNumber: '100',
        };
        const craft = { claim: async (): Promise<CraftClaimResult> => claim };
        const context = { craft, appConfig: appConfigStub, logger: new NoopLogger() } as unknown as AppContext;
        const handler = capture(registerClaimCraftTool, context);

        const result = await handler({ tokenId: '42' });
        expect(result.content[0]?.text).toMatch(/Claimed 1 batch\(es\) → 20 Steel \(#102\)/);
    });

    it('reports a no-op claim when nothing matured', async () => {
        const claim: CraftClaimResult = {
            tokenId: '42',
            recipeId: null,
            batches: 0,
            claimedBatches: null,
            outputs: [],
            txHash: `0x${'1'.repeat(64)}`,
            status: TxStatus.Success,
            blockNumber: '100',
        };
        const craft = { claim: async (): Promise<CraftClaimResult> => claim };
        const context = { craft, appConfig: appConfigStub, logger: new NoopLogger() } as unknown as AppContext;
        const handler = capture(registerClaimCraftTool, context);

        const result = await handler({ tokenId: '42' });
        expect(result.content[0]?.text).toMatch(/nothing matured/i);
    });
});
