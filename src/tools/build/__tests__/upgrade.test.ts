import { describe, expect, it } from 'vitest';
import type { ZodTypeAny } from 'zod';

import { BuildingType } from '../../../api/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { makeConfig } from '../../../services/__tests__/service-fakes.js';
import type { UpgradeResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { TxStatus } from '../../../wallet/types.js';
import { ToolEventType, type ToolRegistrar } from '../../types.js';
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
        const panel = (await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' })).content[0]?.text ?? '';

        expect(panel).toMatch(/^BUILDING UPGRADE\n/);
        expect(panel).toMatch(/Cell: 42 \| From: mine/);
        expect(panel).toMatch(/To: mine_l2a/);
        expect(panel).toMatch(/Approve tx: 0xapprove/);
        expect(panel).toMatch(/Upgrade tx: 0xf+/);
        expect(panel).toMatch(/15 \$CPU/);
        expect(panel).toMatch(/3 Concrete \(#101\)/);
        expect(panel).toMatch(/Finishes: 2023-11-14/);
    });

    it('leaves the machine-readable block as the service result tagged with the event type', async () => {
        const outcome = result();
        const { handler } = harness(outcome);
        const { content } = await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' });

        expect(content[1]?.text).toBe(JSON.stringify({ ...outcome, eventType: ToolEventType.UpgradeStarted }));
        expect(content).toHaveLength(2);
        expect(await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' })).not.toHaveProperty(
            'structuredContent',
        );
    });

    it('leaves the event out of the machine block when the target already stood and nothing was sent', async () => {
        const standing = result({
            noop: true,
            upgrading: true,
            buildCost: '0',
            buildInputs: [],
            approveTxHash: null,
            txHash: null,
            status: null,
            blockNumber: null,
        });
        const { handler } = harness(standing);
        const { content } = await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' });

        expect(content[1]?.text).toBe(JSON.stringify(standing));
        expect(JSON.parse(content[1]?.text ?? '{}')).not.toHaveProperty('eventType');
        expect(content).toHaveLength(2);
    });

    it('names its own event, distinct from a placement', async () => {
        const { handler } = harness(result());
        const { content } = await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' });

        const parsed = JSON.parse(content[1]?.text ?? '{}') as { eventType: string };
        expect(parsed.eventType).toBe(ToolEventType.UpgradeStarted);
        expect(parsed.eventType).not.toBe(ToolEventType.BuildStarted);
    });

    it('says construction started rather than that the building is usable', async () => {
        const { handler } = harness(result());
        const panel = (await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' })).content[0]?.text ?? '';

        expect(panel).toMatch(/construction started/);
        expect(panel).toMatch(/unavailable until it ends/);
        expect(panel).not.toMatch(/\b(ready|complete|completed|completes|finished)\b/i);
    });

    it('marks the finish time absent when the receipt carried no decodable one', async () => {
        const { handler } = harness(result({ finishAt: null }));
        const panel = (await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' })).content[0]?.text ?? '';

        expect(panel).toMatch(/Finishes: n\/a/);
    });

    it('marks the approve transaction absent when the allowance already covered the cost', async () => {
        const { handler } = harness(result({ approveTxHash: null }));
        const panel = (await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' })).content[0]?.text ?? '';

        expect(panel).toMatch(/Approve tx: n\/a/);
        expect(panel).not.toMatch(/0xapprove/);
    });

    it('keeps the materials field when the target consumes none from the warehouse', async () => {
        const { handler } = harness(result({ buildInputs: [] }));
        const panel = (await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' })).content[0]?.text ?? '';

        expect(panel).toMatch(/Materials: n\/a/);
        expect(panel).not.toMatch(/Concrete/);
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
        const panel = (await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' })).content[0]?.text ?? '';

        expect(panel).toMatch(/^BUILDING UPGRADE\n/);
        expect(panel).toMatch(/To: mine_l2a/);
        expect(panel).toMatch(/no transaction sent/i);
        expect(panel).toMatch(/still going up/i);
        expect(panel).toMatch(/Upgrade tx: n\/a/);
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
        const panel = (await handler({ tokenId: '42', targetBuildingType: 'mine_l2a' })).content[0]?.text ?? '';

        expect(panel).toMatch(/^BUILDING UPGRADE\n/);
        expect(panel).toMatch(/To: mine_l2a/);
        expect(panel).toMatch(/no transaction sent/i);
        expect(panel).toMatch(/no construction running/i);
        expect(panel).toMatch(/Finishes: n\/a/);
    });
});
