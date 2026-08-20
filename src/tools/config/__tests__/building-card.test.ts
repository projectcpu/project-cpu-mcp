import { describe, expect, it } from 'vitest';

import { BuildingKind, BuildingType, CraftRecipeId, RandomnessKind } from '../../../api/types.js';
import { Network } from '../../../config/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { type AppConfig, type CatalogBuildingView, ModeSwitchKind } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerGetBuildingTool } from '../building-card/building-card.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

const MINE: CatalogBuildingView = {
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
    upgradeTo: ['mine_l2'],
    family: 'mine',
    level: 1,
    branch: null,
};

const MINE_L2: CatalogBuildingView = {
    ...MINE,
    type: 'mine_l2' as BuildingType,
    onChainId: 46,
    name: 'Deep Mine',
    tier: 2,
    buildCost: '15',
    buildInputs: [{ resourceId: 102, amount: 3 }],
    effects: { cycleTimeBp: 9000, extractionShareBp: 7500, inputEfficiency: [] },
    upgradeFrom: 'mine',
    upgradeTo: [],
    level: 2,
    branch: 'a',
};

const STEEL_MILL: CatalogBuildingView = {
    type: BuildingType.SteelMill,
    onChainId: 11,
    name: 'Steel Mill',
    kind: BuildingKind.Crafter,
    tier: 2,
    buildCost: '20',
    buildTimeSec: 900,
    buildInputs: [{ resourceId: 5, amount: 7 }],
    demolishCost: { cpu: '10', inputs: [{ resourceId: 101, amount: 1 }] },
    modeSwitchCost: null,
    modeSwitch: { kind: ModeSwitchKind.Impossible },
    minableResources: [],
    recipes: [CraftRecipeId.SmeltSteel],
    effects: { cycleTimeBp: 10000, extractionShareBp: 10000, inputEfficiency: [{ resourceId: 5, percent: 80 }] },
    recipeOpexCpu: { smelt_steel: '2' },
    upgradeFrom: null,
    upgradeTo: [],
    family: null,
    level: null,
    branch: null,
};

const HUB: CatalogBuildingView = {
    ...MINE,
    type: BuildingType.Hub,
    onChainId: 22,
    name: 'Hub',
    kind: BuildingKind.Hub,
    tier: 1,
    buildCost: '30',
    buildInputs: [],
    minableResources: [],
    recipes: [],
    modeSwitchCost: null,
    modeSwitch: { kind: ModeSwitchKind.Impossible },
    upgradeFrom: null,
    upgradeTo: [],
    family: null,
    level: null,
    branch: null,
};

const CONFIG: AppConfig = {
    network: Network.ROBINHOOD,
    chainId: 4663,
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
    resources: { 5: 'Iron', 6: 'Copper', 101: 'Concrete', 102: 'Steel' },
    recipes: [
        {
            id: CraftRecipeId.SmeltSteel,
            name: 'Smelt Steel',
            tier: 2,
            inputs: [{ resourceId: 5, amount: 4 }],
            outputs: [{ resourceId: 102, amount: 2 }],
            durationSec: 30,
            costCpu: '3',
        },
    ],
    buildings: [MINE, MINE_L2, STEEL_MILL, HUB],
    reveal: { ethContribution: '0.001', cpuBurn: '2' },
    transport: { moveRadius: 1, hubRadius: 3, moveTimePerCellSec: 2, moveFeeFloors: { 5: '0.1' } },
    trade: { saleBurnPercent: 1, maxSaleFeePercent: 50 },
    storage: { caps: [{ resourceId: 1, cellCap: 100, hubCap: 1000 }] },
};

interface RegisteredTool {
    name: string;
    description: string;
    inputKeys: Array<string>;
    call: (args: { buildingType: string }) => Promise<ToolResult>;
}

function register(config: AppConfig = CONFIG): RegisteredTool {
    const context = {
        appConfig: { load: async () => config },
        logger: new NoopLogger(),
    } as unknown as AppContext;
    let registered: RegisteredTool | null = null;
    const server = {
        registerTool(
            name: string,
            definition: { description: string; inputSchema: Record<string, unknown> },
            handler: (args: { buildingType: string }) => Promise<ToolResult>,
        ): void {
            registered = {
                name,
                description: definition.description,
                inputKeys: Object.keys(definition.inputSchema),
                call: handler,
            };
        },
    } as unknown as ToolRegistrar;
    registerGetBuildingTool(server, context);
    if (registered === null) {
        throw new Error('tool was not registered');
    }
    return registered;
}

async function card(buildingType: string, config: AppConfig = CONFIG): Promise<string> {
    const result = await register(config).call({ buildingType });
    return result.content[0]?.text ?? '';
}

async function machineBlock(buildingType: string): Promise<Record<string, unknown>> {
    const result = await register().call({ buildingType });
    return JSON.parse(result.content[1]?.text ?? '{}') as Record<string, unknown>;
}

function section(text: string, title: string): string {
    const titles = ['Construction', 'Operation', 'Lifecycle'];
    const start = text.indexOf(`${title}\n`);
    expect(start, `card has no ${title} section`).toBeGreaterThanOrEqual(0);
    const nextStarts = titles
        .filter((other) => other !== title)
        .map((other) => text.indexOf(`${other}\n`, start + title.length))
        .filter((at) => at >= 0);
    return text.slice(start, nextStarts.length > 0 ? Math.min(...nextStarts) : text.length);
}

describe('get_building tool', () => {
    it('registers one tool taking the building type as its only input', () => {
        const tool = register();

        expect(tool.name).toMatch(/^cpu_[a-z_]+$/);
        expect(tool.inputKeys).toEqual(['buildingType']);
    });

    it('prints the three canon sections in a stable order', async () => {
        const text = await card(BuildingType.SteelMill);

        const order = ['Construction', 'Operation', 'Lifecycle'].map((title) => text.indexOf(`${title}\n`));
        expect(order.every((at) => at >= 0)).toBe(true);
        expect(order).toEqual([...order].sort((a, b) => a - b));
    });

    it('keeps build materials out of the operation plan and never calls them a recipe', async () => {
        const text = await card(BuildingType.SteelMill);
        const construction = section(text, 'Construction');
        const operation = section(text, 'Operation');

        expect(construction).toContain('Build inputs');
        expect(construction).toContain('7 Iron');
        expect(construction).not.toMatch(/recipe/i);
        expect(operation).not.toMatch(/build input/i);
    });

    it('names the recipe plan apart from the build plan for the very same resource', async () => {
        const operation = section(await card(BuildingType.SteelMill), 'Operation');

        expect(operation).toContain('Recipe inputs');
        expect(operation).toContain('Recipe outputs');
        expect(operation).toContain('4 Iron');
        expect(operation).toContain('2 Steel');
        expect(operation).not.toContain('7 Iron');
    });

    it('carries the crafter cycle duration and its operating cost', async () => {
        const operation = section(await card(BuildingType.SteelMill), 'Operation');

        expect(operation).toContain('30s');
        expect(operation).toContain('2 $CPU');
    });

    it('says outright that an extractor consumes no input resources', async () => {
        const operation = section(await card(BuildingType.Mine), 'Operation');

        expect(operation).toContain('Minable resources');
        expect(operation).toContain('Iron');
        expect(operation).toContain('Copper');
        expect(operation).toMatch(/no input resources/i);
        expect(operation).not.toContain('Recipe inputs');
    });

    it('prints resources by name rather than by bare id', async () => {
        const text = await card(BuildingType.SteelMill);

        expect(text).toContain('Iron');
        expect(text).toContain('Steel');
        expect(text).not.toMatch(/\bresourceId\b/);
    });

    it('carries the lifecycle facts including both upgrade directions', async () => {
        const mine = section(await card(BuildingType.Mine), 'Lifecycle');
        const upgraded = section(await card('mine_l2'), 'Lifecycle');

        expect(mine).toContain('2.5 $CPU');
        expect(mine).toContain('mine_l2');
        expect(upgraded).toContain('mine');
        expect(mine).toMatch(/switch/i);
    });

    it('keeps a building that can never switch its mode apart from a free one', async () => {
        const lifecycle = section(await card(BuildingType.SteelMill), 'Lifecycle');

        expect(lifecycle).toMatch(/cannot switch|never switch|impossible/i);
        expect(lifecycle).not.toMatch(/switch[^\n]*\b0 \$CPU/i);
    });

    it('gives the hub an operation plan of its own with neither recipes nor minable resources', async () => {
        const operation = section(await card(BuildingType.Hub), 'Operation');

        expect(operation).not.toContain('Recipe inputs');
        expect(operation).not.toContain('Minable resources');
        expect(operation.trim().split('\n').length).toBeGreaterThan(1);
    });

    it('refuses an unknown building type with a readable error', async () => {
        await expect(register().call({ buildingType: 'steel_mil' })).rejects.toThrow(/steel_mil/);
        await expect(register().call({ buildingType: 'steel_mil' })).rejects.toThrow(/cpu_get_game_config/);
    });

    it('answers the catalog type whatever the case it arrives in', async () => {
        expect(await card('  Steel_Mill ')).toContain('Steel Mill');
    });

    it('carries the machine block under the canon field names', async () => {
        const mill = await machineBlock(BuildingType.SteelMill);
        const mine = await machineBlock(BuildingType.Mine);
        const construction = mill.construction as Record<string, unknown>;
        const operation = mill.operation as Record<string, unknown>;
        const lifecycle = mill.lifecycle as Record<string, unknown>;
        const recipes = operation.recipes as Array<Record<string, unknown>>;

        expect(Object.keys(mill)).toContain('construction');
        expect(construction.buildInputs).toEqual([{ resourceId: 5, resourceName: 'Iron', amount: 7 }]);
        expect(recipes[0]?.recipeInputs).toEqual([{ resourceId: 5, resourceName: 'Iron', amount: 4 }]);
        expect(recipes[0]?.recipeOutputs).toEqual([{ resourceId: 102, resourceName: 'Steel', amount: 2 }]);
        expect(operation.minableResources).toEqual([]);
        expect(lifecycle.upgradeTo).toEqual([]);
        expect((mine.operation as Record<string, unknown>).minableResources).toEqual([
            { resourceId: 5, resourceName: 'Iron' },
            { resourceId: 6, resourceName: 'Copper' },
        ]);
        expect((mine.operation as Record<string, unknown>).recipes).toEqual([]);
    });

    it('describes the two input plans apart in the tool description', () => {
        const { description } = register();

        expect(description).toMatch(/build input/i);
        expect(description).toMatch(/recipe input/i);
    });

    it('holds a recipe id the loaded config carries no details for without dropping it', async () => {
        const orphaned: AppConfig = { ...CONFIG, recipes: [] };

        const operation = section(await card(BuildingType.SteelMill, orphaned), 'Operation');

        expect(operation).toContain(CraftRecipeId.SmeltSteel);
    });
});
