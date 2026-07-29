import { describe, expect, it } from 'vitest';

import { BuildingType } from '../../../api/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import type { DemolishResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { TxStatus } from '../../../wallet/types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerDemolishTool } from '../demolish.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Handler = (args: { tokenId: string }) => Promise<ToolResult>;

const RESOURCES = { 101: 'Concrete' };

function harness(outcome: DemolishResult | Error): Handler {
    const build = {
        demolish: async (): Promise<DemolishResult> => {
            if (outcome instanceof Error) {
                throw outcome;
            }
            return outcome;
        },
    };
    const appConfig = { load: async () => ({ resources: RESOURCES }) };
    const context = { build, appConfig, logger: new NoopLogger() } as unknown as AppContext;

    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    registerDemolishTool(server, context);
    if (captured === null) {
        throw new Error('demolish was not registered');
    }
    return captured;
}

function result(overrides: Partial<DemolishResult> = {}): DemolishResult {
    return {
        tokenId: '42',
        buildingType: BuildingType.Mine,
        cpuBurned: '2.5',
        inputsConsumed: [],
        rebuildUnlockAt: 1_700_000_000,
        rebuildCooldownSec: 120,
        approveTxHash: null,
        txHash: `0x${'d'.repeat(64)}`,
        status: TxStatus.Success,
        blockNumber: '100',
        ...overrides,
    };
}

describe('demolish tool', () => {
    it('reports the burned $CPU and the exact rebuild unlock time from the event', async () => {
        const header = (await harness(result())({ tokenId: '42' })).content[0]?.text ?? '';
        expect(header).toMatch(/Demolished the mine on cell 42/);
        expect(header).toMatch(/burned 2\.5 \$CPU/);
        expect(header).toMatch(/locked from rebuilding until .+ \(~120s\)/);
        expect(header).toMatch(/block 100/);
    });

    it('degrades to a soft note when the receipt carried no demolish finish time', async () => {
        const outcome = result({ rebuildUnlockAt: null, rebuildCooldownSec: null });
        const header = (await harness(outcome)({ tokenId: '42' })).content[0]?.text ?? '';
        expect(header).toMatch(/locked from rebuilding; the exact demolishFinishAt settles on the map shortly/);
    });

    it('names the warehouse resources it consumed', async () => {
        const outcome = result({
            buildingType: BuildingType.SteelMill,
            cpuBurned: '10',
            inputsConsumed: [{ resourceId: 101, amount: 2 }],
        });
        const header = (await harness(outcome)({ tokenId: '42' })).content[0]?.text ?? '';
        expect(header).toMatch(/plus 2 Concrete \(#101\) from its warehouse/);
    });

    it('propagates service errors', async () => {
        await expect(harness(new Error('CellBusy'))({ tokenId: '42' })).rejects.toThrow(/CellBusy/);
    });
});
