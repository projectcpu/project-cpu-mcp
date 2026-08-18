import { describe, expect, it } from 'vitest';

import { BuildingType, CraftRecipeId } from '../../../api/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { type CellInspection, CellProcessKind, NeighborRelation } from '../../../map/types.js';
import { makeConfig } from '../../../services/__tests__/service-fakes.js';
import type { AppConfig, CellOutputView } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { formatUnixSeconds } from '../../../utils/format.utils.js';
import type { ToolRegistrar } from '../../types.js';
import { registerGetCellTool } from '../get-cell/get-cell.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Handler = (args: unknown) => Promise<ToolResult>;

function harness(inspection: CellInspection | null, serverTime = 0): Handler {
    const map = {
        inspectCell: (): CellInspection | null => inspection,
        getServerTime: (): number => serverTime,
    };
    const wallet = { isReady: () => true, get: () => ({ getAddress: () => '0xMe' }) };
    const appConfig = {
        load: async (): Promise<Pick<AppConfig, 'resources' | 'buildings'>> => ({
            resources: { 3: 'Silica', 5: 'Iron', 6: 'Copper', 7: 'Water' },
            buildings: makeConfig().buildings,
        }),
    };
    const context = { mapReader: map, wallet, appConfig, logger: new NoopLogger() } as unknown as AppContext;

    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    registerGetCellTool(server, context);
    if (captured === null) {
        throw new Error('get_cell was not registered');
    }
    return captured;
}

const inspection: CellInspection = {
    cell: {
        tokenId: '7',
        pos: { face: 0, i: 0, j: 7 },
        owner: '0xrival',
        revealCount: 1,
        revealPending: false,
        resources: [{ resourceId: 3, deposit: '100', balance: '0', strength: 3, storage: null }],
        building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: null, modeRecipeId: null },
        demolishFinishAt: null,
        demolishStartAt: null,
        demolishingType: null,
        transitFeeOverrides: { 3: '0.5' },
        saleFeeOverrides: { 3: 2.5 },
        process: {
            kind: CellProcessKind.Mining,
            resource: 3,
            durationSec: 180,
            yieldPerCycle: 77,
            processDrawPerCycle: 77,
            batches: 10,
            claimedBatches: 0,
            startAt: 1700,
            stalled: false,
        },
        updated: 10,
        ready: true,
        activeHub: false,
        neighbors: [{ tokenId: '8', relation: NeighborRelation.Owned }],
    },
    neighbors: [],
    distanceFromMine: 2,
};

async function outputsOf(target: CellInspection): Promise<Array<CellOutputView> | null> {
    const result = await harness(target)({ tokenId: '7' });
    const parsed = JSON.parse(result.content[1]?.text ?? '{}') as {
        cell: { outputs: Array<CellOutputView> | null };
    };
    return parsed.cell.outputs;
}

describe('get_cell tool', () => {
    it('returns the inspection, with resource ids labeled from config', async () => {
        const handler = harness(inspection);
        const result = await handler({ tokenId: '7' });
        const parsed = JSON.parse(result.content[1]?.text ?? '{}') as {
            cell: {
                tokenId: string;
                resources: Array<{ resourceId: number; resourceName: string }>;
                building: { type: string } | null;
                process: { kind: string; resourceName: string } | null;
                transitFeeOverrides: Record<number, string> | null;
                saleFeeOverrides: Record<number, number> | null;
            };
            distanceFromMine: number;
        };
        expect(parsed.cell.tokenId).toBe('7');
        expect(parsed.distanceFromMine).toBe(2);
        expect(parsed.cell.resources[0]?.resourceName).toBe('Silica');
        expect(parsed.cell.building?.type).toBe('mine');
        expect(parsed.cell.process?.resourceName).toBe('Silica');
        expect(parsed.cell.transitFeeOverrides).toEqual({ 3: '0.5' });
        expect(parsed.cell.saleFeeOverrides).toEqual({ 3: 2.5 });
    });

    it('throws when the cell is not in the map', async () => {
        const handler = harness(null);
        await expect(handler({ tokenId: 'missing' })).rejects.toThrow(/not in the current map/i);
    });

    it('lists both of a switchable extractor’s resources — the one it is on free, the other priced', async () => {
        const pointed: CellInspection = {
            ...inspection,
            cell: {
                ...inspection.cell,
                building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: 5, modeRecipeId: null },
            },
        };
        const outputs = (await outputsOf(pointed)) ?? [];

        expect(outputs).toEqual([
            { resourceId: 5, resourceName: 'Iron', recipeId: null, cost: { kind: 'free', why: 'same_output' } },
            { resourceId: 6, resourceName: 'Copper', recipeId: null, cost: { kind: 'paid', costCpu: '1' } },
        ]);
    });

    it('lists a switchable crafter’s recipes, pricing against the recipe mode the map carries', async () => {
        const fab: CellInspection = {
            ...inspection,
            cell: {
                ...inspection.cell,
                building: {
                    type: BuildingType.WaferFab,
                    buildFinishAt: null,
                    modeResource: null,
                    modeRecipeId: CraftRecipeId.SmeltSteel,
                },
            },
        };
        const outputs = (await outputsOf(fab)) ?? [];

        expect(outputs).toEqual([
            {
                resourceId: null,
                resourceName: null,
                recipeId: CraftRecipeId.SmeltSteel,
                cost: { kind: 'free', why: 'same_output' },
            },
            {
                resourceId: null,
                resourceName: null,
                recipeId: CraftRecipeId.ForgeWcpu,
                cost: { kind: 'paid', costCpu: '22' },
            },
        ]);
    });

    it('reports a fresh build’s first pick as free rather than as a price of zero', async () => {
        const outputs = (await outputsOf(inspection)) ?? [];

        expect(outputs.map((o) => o.cost)).toEqual([
            { kind: 'free', why: 'first_pick' },
            { kind: 'free', why: 'first_pick' },
        ]);
    });

    it('carries no price field at all for a building that can never switch', async () => {
        const pump: CellInspection = {
            ...inspection,
            cell: {
                ...inspection.cell,
                building: { type: BuildingType.PumpStation, buildFinishAt: null, modeResource: 7, modeRecipeId: null },
            },
        };
        const outputs = (await outputsOf(pump)) ?? [];

        expect(outputs).toEqual([
            { resourceId: 7, resourceName: 'Water', recipeId: null, cost: { kind: 'free', why: 'same_output' } },
        ]);
        expect(JSON.stringify(outputs)).not.toMatch(/costCpu/);
    });

    it('offers a hub no outputs at all rather than an unpriceable one', async () => {
        const hub: CellInspection = {
            ...inspection,
            cell: {
                ...inspection.cell,
                building: { type: BuildingType.Hub, buildFinishAt: null, modeResource: null, modeRecipeId: null },
            },
        };
        expect(await outputsOf(hub)).toEqual([]);
    });

    it('offers no outputs on a bare cell', async () => {
        const bare: CellInspection = { ...inspection, cell: { ...inspection.cell, building: null } };
        expect(await outputsOf(bare)).toBeNull();
    });

    it('notes the demolition cooldown while the cell is still locked', async () => {
        const cooling: CellInspection = {
            ...inspection,
            cell: { ...inspection.cell, building: null, demolishFinishAt: 500 },
        };
        const header = (await harness(cooling, 100)({ tokenId: '7' })).content[0]?.text ?? '';
        expect(header).toMatch(/demolition cooldown until/i);
    });

    it('names what is coming down and when it began once the server records them', async () => {
        const cooling: CellInspection = {
            ...inspection,
            cell: {
                ...inspection.cell,
                building: null,
                demolishFinishAt: 500,
                demolishStartAt: 20,
                demolishingType: 'mine',
            },
        };
        const header = (await harness(cooling, 100)({ tokenId: '7' })).content[0]?.text ?? '';
        expect(header).toMatch(/demolishing mine/);
        expect(header).toMatch(/started /);
    });

    it('leaves the header exactly as it was when the demolition metadata is unknown', async () => {
        const withMeta: CellInspection = {
            ...inspection,
            cell: { ...inspection.cell, building: null, demolishFinishAt: 500 },
        };
        const header = (await harness(withMeta, 100)({ tokenId: '7' })).content[0]?.text ?? '';
        expect(header).toBe(
            `Cell 7 · 0 neighbours · demolition cooldown until ${formatUnixSeconds(500)} (no rebuild yet)`,
        );
    });

    it('carries both demolition metadata fields into the cell dump', async () => {
        const cooling: CellInspection = {
            ...inspection,
            cell: {
                ...inspection.cell,
                building: null,
                demolishFinishAt: 500,
                demolishStartAt: 20,
                demolishingType: 'mine',
            },
        };
        const result = await harness(cooling, 100)({ tokenId: '7' });
        const parsed = JSON.parse(result.content[1]?.text ?? '{}') as {
            cell: { demolishStartAt: number | null; demolishingType: string | null };
        };
        expect(parsed.cell.demolishStartAt).toBe(20);
        expect(parsed.cell.demolishingType).toBe('mine');
    });
});
