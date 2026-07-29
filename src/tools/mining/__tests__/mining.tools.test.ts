import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../../logger/noop.logger.js';
import type { MiningClaimResult, MiningStatusResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { TxStatus } from '../../../wallet/types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerClaimMiningTool } from '../claim/claim-mining.js';
import { registerGetMiningStatusTool } from '../get-status/get-mining-status.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Handler = (args: { tokenId: string }) => Promise<ToolResult>;

const appConfigStub = {
    load: async (): Promise<{ resources: Record<number, string> }> => ({ resources: { 3: 'Silica' } }),
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

function statusHarness(outcome: MiningStatusResult | Error): Handler {
    const mining = {
        getStatus: async (): Promise<MiningStatusResult> => {
            if (outcome instanceof Error) {
                throw outcome;
            }
            return outcome;
        },
    };
    const context = { mining, appConfig: appConfigStub, logger: new NoopLogger() } as unknown as AppContext;
    return capture(registerGetMiningStatusTool, context);
}

function claimHarness(outcome: MiningClaimResult | Error): Handler {
    const mining = {
        claim: async (): Promise<MiningClaimResult> => {
            if (outcome instanceof Error) {
                throw outcome;
            }
            return outcome;
        },
    };
    const context = { mining, appConfig: appConfigStub, logger: new NoopLogger() } as unknown as AppContext;
    return capture(registerClaimMiningTool, context);
}

describe('get_mining_status tool', () => {
    it('summarizes an active job with its yield, schedule, cycle timing, and resource name', async () => {
        const result = await statusHarness({
            tokenId: '42',
            active: true,
            serverTime: 2000,
            targetResourceId: 3,
            yieldPerCycle: 77,
            durationSec: 180,
            startAt: 1700,
            batches: 10,
            claimedBatches: 0,
            completedBatches: 2,
            claimableBatches: 2,
            isFinished: false,
            endsAtSec: 3500,
            nextBatchAtSec: 2030,
            claimable: '120',
            depositRemaining: '500',
            stalled: false,
            warehouseUsed: null,
            warehouseCap: null,
        })({ tokenId: '42' });

        const header = result.content[0]?.text ?? '';
        expect(header).toMatch(/Silica \(#3\)/);
        expect(header).toMatch(/77 per 3 minutes cycle/);
        expect(header).toMatch(/120 claimable now \(2 cycles, 2\/10 cycles done\)/);
        expect(header).toMatch(/next in 30 seconds/);
        expect(header).toMatch(/500 left/);

        const parsed = JSON.parse(result.content[1]?.text ?? '{}') as MiningStatusResult;
        expect(parsed.targetResourceId).toBe(3);
    });

    it('reports an inactive cell', async () => {
        const result = await statusHarness({
            tokenId: '42',
            active: false,
            serverTime: 2000,
            targetResourceId: null,
            yieldPerCycle: null,
            durationSec: null,
            startAt: null,
            batches: 0,
            claimedBatches: 0,
            completedBatches: 0,
            claimableBatches: 0,
            isFinished: false,
            endsAtSec: null,
            nextBatchAtSec: null,
            claimable: '0',
            depositRemaining: '0',
            stalled: false,
            warehouseUsed: null,
            warehouseCap: null,
        })({ tokenId: '42' });

        expect(result.content[0]?.text).toMatch(/no active mining/i);
    });
});

describe('claim_mining tool', () => {
    it('reports the claimed amount', async () => {
        const result = await claimHarness({
            tokenId: '42',
            resourceId: 3,
            claimedBatches: 1,
            claimedAmount: '120',
            txHash: '0xmine',
            status: TxStatus.Success,
            blockNumber: '100',
        })({ tokenId: '42' });

        const header = result.content[0]?.text ?? '';
        expect(header).toMatch(/Claimed 120 Silica \(#3\)/);
        expect(header).toMatch(/block 100/);
    });

    it('reports a no-op claim when nothing has newly matured', async () => {
        const result = await claimHarness({
            tokenId: '42',
            resourceId: null,
            claimedBatches: null,
            claimedAmount: '0',
            txHash: '0xmine',
            status: TxStatus.Success,
            blockNumber: '100',
        })({ tokenId: '42' });

        expect(result.content[0]?.text).toMatch(/nothing newly matured/i);
    });

    it('propagates service errors', async () => {
        await expect(claimHarness(new Error('NotCellOwner'))({ tokenId: '42' })).rejects.toThrow(/NotCellOwner/);
    });
});
