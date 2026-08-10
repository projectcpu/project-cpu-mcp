import { describe, expect, it } from 'vitest';

import { BuildingKind, BuildingType, CraftRecipeId, RandomnessKind } from '../../../api/types.js';
import { Network } from '../../../config/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { type AppConfig, ModeSwitchKind } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerGetGameConfigTool } from '../get-game-config/get-game-config.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

const CONFIG: AppConfig = {
    network: Network.ETHEREUM,
    chainId: 1,
    contracts: {
        land: '0xland',
        cpuToken: '0xcpu',
        cpuHook: '0x4444444444444444444444444444444444444444',
        cell: '0x5555555555555555555555555555555555555555',
        cellLens: '0x6666666666666666666666666666666666666666',
        transport: '0x7777777777777777777777777777777777777777',
        trade: '0x8888888888888888888888888888888888888888',
        syndicate: '0x9999999999999999999999999999999999999999',
    },
    randomness: { kind: RandomnessKind.ENTROPY, adapter: '0x00000000000000000000000000000000000000a1' },
    resources: { 5: 'Iron', 101: 'Concrete', 102: 'Steel' },
    recipes: [
        {
            id: CraftRecipeId.SmeltSteel,
            name: 'Smelt Steel',
            tier: 2,
            inputs: [{ resourceId: 5, amount: 4 }],
            outputs: [{ resourceId: 102, amount: 2 }],
            durationSec: 30,
            costCpu: '0',
        },
    ],
    buildings: [
        {
            type: BuildingType.Mine,
            onChainId: 4,
            name: 'Mine',
            kind: BuildingKind.Extractor,
            tier: 1,
            buildCost: '5',
            buildTimeSec: 120,
            buildInputs: [],
            demolishCost: { cpu: '2.5', inputs: [] },
            modeSwitchCost: '1',
            modeSwitch: { kind: ModeSwitchKind.Possible, costCpu: '1' },
            minableResources: [5, 6],
            recipes: [],
            effects: { cycleTimeBp: 10000, extractionShareBp: 10000, inputEfficiency: [] },
            recipeOpexCpu: null,
            upgradeFrom: null,
            upgradeTo: ['mine_branch_a_l2', 'mine_branch_b_l2'],
            family: 'mine',
            level: 1,
            branch: null,
        },
        {
            type: BuildingType.SteelMill,
            onChainId: 11,
            name: 'Steel Mill',
            kind: BuildingKind.Crafter,
            tier: 2,
            buildCost: '20',
            buildTimeSec: 900,
            buildInputs: [],
            demolishCost: { cpu: '10', inputs: [] },
            modeSwitchCost: null,
            modeSwitch: { kind: ModeSwitchKind.Impossible },
            minableResources: [],
            recipes: [CraftRecipeId.SmeltSteel],
            effects: { cycleTimeBp: 10000, extractionShareBp: 10000, inputEfficiency: [] },
            recipeOpexCpu: { smelt_steel: '2' },
            upgradeFrom: null,
            upgradeTo: [],
            family: null,
            level: null,
            branch: null,
        },
        {
            type: 'mine_branch_a_l2' as BuildingType,
            onChainId: 46,
            name: 'Mine Branch A L2',
            kind: BuildingKind.Extractor,
            tier: 2,
            buildCost: '15',
            buildTimeSec: 300,
            buildInputs: [{ resourceId: 101, amount: 3 }],
            demolishCost: { cpu: '7.5', inputs: [] },
            modeSwitchCost: '1',
            modeSwitch: { kind: ModeSwitchKind.Possible, costCpu: '1' },
            minableResources: [5, 6],
            recipes: [],
            effects: { cycleTimeBp: 9000, extractionShareBp: 10000, inputEfficiency: [] },
            recipeOpexCpu: null,
            upgradeFrom: 'mine',
            upgradeTo: ['mine_branch_a_l3'],
            family: 'mine',
            level: 2,
            branch: 'a',
        },
        {
            type: 'mine_branch_a_l3' as BuildingType,
            onChainId: 47,
            name: 'Mine Branch A L3',
            kind: BuildingKind.Extractor,
            tier: 3,
            buildCost: '40',
            buildTimeSec: 600,
            buildInputs: [{ resourceId: 102, amount: 2 }],
            demolishCost: { cpu: '20', inputs: [] },
            modeSwitchCost: '1',
            modeSwitch: { kind: ModeSwitchKind.Possible, costCpu: '1' },
            minableResources: [5, 6],
            recipes: [],
            effects: { cycleTimeBp: 8000, extractionShareBp: 10000, inputEfficiency: [] },
            recipeOpexCpu: null,
            upgradeFrom: 'mine_branch_a_l2',
            upgradeTo: [],
            family: 'mine',
            level: 3,
            branch: 'a',
        },
        {
            type: 'mine_branch_b_l2' as BuildingType,
            onChainId: 48,
            name: 'Mine Branch B L2',
            kind: BuildingKind.Extractor,
            tier: 2,
            buildCost: '18',
            buildTimeSec: 360,
            buildInputs: [],
            demolishCost: { cpu: '9', inputs: [] },
            modeSwitchCost: '1',
            modeSwitch: { kind: ModeSwitchKind.Possible, costCpu: '1' },
            minableResources: [5, 6],
            recipes: [],
            effects: { cycleTimeBp: 11000, extractionShareBp: 12000, inputEfficiency: [] },
            recipeOpexCpu: null,
            upgradeFrom: 'mine',
            upgradeTo: [],
            family: 'mine',
            level: 2,
            branch: 'b',
        },
    ],
    reveal: { firstFree: true, reRevealCost: '1000' },
    transport: { moveRadius: 1, hubRadius: 3, moveTimePerCellSec: 2, moveFeeFloors: { 5: '0.1' } },
    trade: { saleBurnPercent: 1, maxSaleFeePercent: 50 },
    storage: { hubStorageMultiplier: 10 },
};

function capture(config: AppConfig = CONFIG): (args: never) => Promise<ToolResult> {
    const context = {
        appConfig: { load: async () => config },
        logger: new NoopLogger(),
    } as unknown as AppContext;
    let captured: ((args: never) => Promise<ToolResult>) | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: (args: never) => Promise<ToolResult>): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;
    registerGetGameConfigTool(server, context);
    if (captured === null) {
        throw new Error('tool was not registered');
    }
    return captured;
}

describe('get_game_config tool', () => {
    it('summarizes the rulebook and returns the full config', async () => {
        const result = await capture()({} as never);

        const header = result.content[0]?.text ?? '';
        expect(header).toMatch(/Network ethereum \(chainId 1\)/);
        expect(header).toMatch(/Mine \(extractor, build 5 \$CPU, demolish 2\.5 \$CPU\)/);
        expect(header).toMatch(
            /Steel Mill \(crafter, build 20 \$CPU, demolish 10 \$CPU, opex smelt_steel:2 \$CPU\/batch\)/,
        );
        expect(header).toMatch(/first reveal free, re-reveal 1000 \$CPU/);
        expect(header).toMatch(/1 recipe\(s\)/);
        expect(header).toMatch(/5:Iron/);
        expect(header).toMatch(/cell 0x5555555555555555555555555555555555555555/);
        expect(header).toContain('1% sale burn');
        expect(header).toContain(
            'sale fee up to 100% (the structural bound — a hub owner can set any rate up to this maximum)',
        );
        expect(header).toContain("every resource carries a transit-fee floor ($CPU/u; a hub's non-zero override");
        expect(header).toContain('5:0.1');
        expect(header).toMatch(/an active hub multiplies a cell's storage cap by 10x/);

        const json = JSON.parse(result.content[1]?.text ?? '{}') as AppConfig;
        expect(json.buildings[0]?.buildCost).toBe('5');
        expect(json.reveal.reRevealCost).toBe('1000');
        expect(json.trade).toEqual({ saleBurnPercent: 1, maxSaleFeePercent: 50 });
        expect(json.transport.moveFeeFloors).toEqual({ 5: '0.1' });
        expect(json.storage).toEqual({ hubStorageMultiplier: 10 });
    });

    it('tells a push network that the draw arrives on its own and fulfilment is not the agent’s job', async () => {
        const header = (await capture()({} as never)).content[0]?.text ?? '';

        expect(header).toContain('Randomness: push —');
        expect(header).toContain('deposits land asynchronously');
        expect(header).toContain('has nothing to do on this network');
        expect(header).not.toContain('self-service');
    });

    it('tells a self-service network that reveal finishes the draw itself and what fulfilled: false means', async () => {
        const config: AppConfig = {
            ...CONFIG,
            randomness: {
                kind: RandomnessKind.DRAND,
                adapter: '0x00000000000000000000000000000000000000a2',
                genesis: 1_700_000_000,
                period: 30,
                beaconApi: 'https://beacon.example/v2',
            },
        };

        const header = (await capture(config)({} as never)).content[0]?.text ?? '';

        expect(header).toContain('Randomness: self-service —');
        expect(header).toContain('`fulfilled: false`');
        expect(header).toContain('call `cpu_reveal` on that cell again');
        expect(header).not.toContain('Randomness: push');
    });

    it('phrases the two modes differently and carries the descriptor in the data', async () => {
        const push = (await capture()({} as never)).content[0]?.text ?? '';
        const selfService =
            (
                await capture({
                    ...CONFIG,
                    randomness: {
                        kind: RandomnessKind.DRAND,
                        adapter: '',
                        genesis: 1,
                        period: 3,
                        beaconApi: 'https://beacon.example/v2',
                    },
                })({} as never)
            ).content[0]?.text ?? '';

        expect(push).not.toBe(selfService);

        const json = JSON.parse((await capture()({} as never)).content[1]?.text ?? '{}') as AppConfig;
        expect(json.randomness).toEqual({
            kind: 'entropy',
            adapter: '0x00000000000000000000000000000000000000a1',
        });
    });
});

describe('get_game_config tool — recipe summary', () => {
    it('summarizes each recipe on one compact machine-readable line with its id, cycle, inputs, outputs, and cost', async () => {
        const header = (await capture()({} as never)).content[0]?.text ?? '';

        expect(header).toContain('smelt_steel | 30s/cycle | in 4 Iron (#5) | out 2 Steel (#102) | 0 $CPU/cycle');
    });

    it('preserves recipe cycle duration and outputs in the raw configuration', async () => {
        const json = JSON.parse((await capture()({} as never)).content[1]?.text ?? '{}') as AppConfig;

        expect(json.recipes[0]?.durationSec).toBe(30);
        expect(json.recipes[0]?.outputs).toEqual([{ resourceId: 102, amount: 2 }]);
    });
});

describe('get_game_config tool — upgrade graph', () => {
    it('shows a base building with multiple immediate targets, its level, and no predecessor', async () => {
        const header = (await capture()({} as never)).content[0]?.text ?? '';

        expect(header).toContain(
            'mine | level 1 | branch none | predecessor none (base building) | ' +
                'successors mine_branch_a_l2,mine_branch_b_l2 | cost 5 $CPU',
        );
    });

    it('shows a branch-specific intermediate building with its predecessor and successor', async () => {
        const header = (await capture()({} as never)).content[0]?.text ?? '';

        expect(header).toContain(
            'mine_branch_a_l2 | level 2 | branch a | predecessor mine | successors mine_branch_a_l3 | ' +
                'cost 15 $CPU | inputs 3 Concrete (#101) | build 300s',
        );
    });

    it('shows a terminal upgrade with no successors', async () => {
        const header = (await capture()({} as never)).content[0]?.text ?? '';

        expect(header).toContain(
            'mine_branch_a_l3 | level 3 | branch a | predecessor mine_branch_a_l2 | successors none (terminal)',
        );
        expect(header).toContain(
            'mine_branch_b_l2 | level 2 | branch b | predecessor mine | successors none (terminal)',
        );
    });

    it('excludes buildings that do not participate in any upgrade line', async () => {
        const header = (await capture()({} as never)).content[0]?.text ?? '';

        expect(header).not.toMatch(/steel_mill \|/);
    });

    it('labels cycleTimeBp as a modifier rather than an absolute duration', async () => {
        const header = (await capture()({} as never)).content[0]?.text ?? '';

        expect(header).toContain(
            'cycleTimeBp 9000 (a cycle-time modifier applied on top of the base production cycle, ' +
                'not an absolute duration)',
        );
        expect(header).not.toMatch(/cycleTimeBp 9000 \(9s\)/);
        expect(header).not.toMatch(/cycleTimeBp 9000 seconds/);
    });

    it('does not present extractor-compatible resources as a guaranteed mining yield', async () => {
        const header = (await capture()({} as never)).content[0]?.text ?? '';

        expect(header).toContain('extractor-compatible Iron (#5),resource #6 (compatible resources only');
        expect(header).toContain('actual mining yield is set at runtime, not a guaranteed amount');
    });
});
