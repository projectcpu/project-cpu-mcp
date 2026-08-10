import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';

import { BuildingType } from '../../../api/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { makeConfig } from '../../../services/__tests__/service-fakes.js';
import type { UpgradeResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { TxStatus } from '../../../wallet/types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerUpgradeTool } from '../upgrade.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type UpgradeArgs = { tokenId: string; targetBuildingType: string };
type Handler = (args: UpgradeArgs) => Promise<ToolResult>;

interface Registration {
    handler: Handler;
    inputSchema: Record<string, ZodTypeAny>;
}

function harness(outcome: UpgradeResult | Error): Registration {
    const build = {
        upgrade: async (): Promise<UpgradeResult> => {
            if (outcome instanceof Error) {
                throw outcome;
            }
            return outcome;
        },
    };
    const appConfig = { load: async () => makeConfig() };
    const context = { build, appConfig, logger: new NoopLogger() } as unknown as AppContext;

    let registration: Registration | null = null;
    const server = {
        registerTool(_name: string, def: { inputSchema: Record<string, ZodTypeAny> }, handler: Handler): void {
            registration = { handler, inputSchema: def.inputSchema };
        },
    } as unknown as ToolRegistrar;

    registerUpgradeTool(server, context);
    if (registration === null) {
        throw new Error('upgrade was not registered');
    }
    return registration;
}

function result(overrides: Partial<UpgradeResult> = {}): UpgradeResult {
    return {
        tokenId: '42',
        fromBuildingType: BuildingType.Mine,
        toBuildingType: 'mine_l2a',
        buildCost: '15',
        buildInputs: [{ resourceId: 101, amount: 3 }],
        noop: false,
        upgrading: true,
        finishAt: 1_700_000_900,
        approveTxHash: '0xapprove',
        txHash: `0x${'f'.repeat(64)}`,
        status: TxStatus.Success,
        blockNumber: '100',
        ...overrides,
    };
}

describe('upgrade tool', () => {
    it('registers cpu_upgrade with tokenId and a non-empty string targetBuildingType', () => {
        const { inputSchema } = harness(result());

        expect(inputSchema.tokenId).toBeDefined();
        expect(inputSchema.targetBuildingType).toBeDefined();
        expect(inputSchema.targetBuildingType?.safeParse('mine_l2a').success).toBe(true);
        expect(inputSchema.targetBuildingType?.safeParse('').success).toBe(false);
    });

    it('reports the source/target types, the paid cost and inputs, and the finish time from the event', async () => {
        const { handler } = harness(result());
        const header = (await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' })).content[0]?.text ?? '';

        expect(header).toMatch(/cell 42 from mine to mine_l2a/);
        expect(header).toMatch(/approve tx 0xapprove/);
        expect(header).toMatch(/upgrade tx 0xf+/);
        expect(header).toMatch(/15 \$CPU/);
        expect(header).toMatch(/3 Concrete \(#101\)/);
        expect(header).toMatch(/unavailable until construction completes/);
    });

    it('degrades to a soft note when the receipt carried no decodable finish time', async () => {
        const { handler } = harness(result({ finishAt: null }));
        const header = (await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' })).content[0]?.text ?? '';

        expect(header).toMatch(/finish time settles on the map shortly/);
    });

    it('omits the approve mention when the allowance already covered the cost', async () => {
        const { handler } = harness(result({ approveTxHash: null }));
        const header = (await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' })).content[0]?.text ?? '';

        expect(header).not.toMatch(/approve/i);
    });

    it('omits the warehouse-inputs mention entirely when the target consumes none', async () => {
        const { handler } = harness(result({ buildInputs: [] }));
        const header = (await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' })).content[0]?.text ?? '';

        expect(header).not.toMatch(/plus/i);
        expect(header).not.toMatch(/warehouse/i);
    });

    it('propagates service errors', async () => {
        const { handler } = harness(new Error('InvalidUpgradeTransition'));
        await expect(handler({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /InvalidUpgradeTransition/,
        );
    });

    it('reports a no-op with no transaction when the target is already installed and still upgrading', async () => {
        const { handler } = harness(
            result({
                noop: true,
                upgrading: true,
                finishAt: 1_700_000_900,
                approveTxHash: null,
                txHash: null,
                status: null,
                blockNumber: null,
            }),
        );
        const header = (await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' })).content[0]?.text ?? '';

        expect(header).toMatch(/cell 42 already has mine_l2a installed/i);
        expect(header).toMatch(/no transaction was sent/i);
        expect(header).toMatch(/still upgrading/i);
        expect(header).not.toMatch(/upgrade tx/i);
    });

    it('reports a no-op with no transaction when the target is already installed and ready', async () => {
        const { handler } = harness(
            result({
                noop: true,
                upgrading: false,
                finishAt: null,
                approveTxHash: null,
                txHash: null,
                status: null,
                blockNumber: null,
            }),
        );
        const header = (await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' })).content[0]?.text ?? '';

        expect(header).toMatch(/cell 42 already has mine_l2a installed/i);
        expect(header).toMatch(/no transaction was sent/i);
        expect(header).toMatch(/is ready/i);
    });
});
