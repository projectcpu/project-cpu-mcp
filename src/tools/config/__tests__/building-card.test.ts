import { describe, expect, it, vi } from 'vitest';

import { BuildingKind, BuildingType, CraftRecipeId, RandomnessKind, type RecipeView } from '../../../api/types.js';
import { Network } from '../../../config/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { createServer } from '../../../server.js';
import { type AppConfig, type CatalogBuildingView, ModeSwitchKind } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerGetBuildingTool } from '../building-card/building-card.js';
import { summarizeBuildingRole } from '../building-card/building-card.utils.js';

const sdk = vi.hoisted(() => ({ toolNames: new Array<string>() }));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
    McpServer: class McpServerStub {
        registerTool(name: string): void {
            sdk.toolNames.push(name);
        }

        connect(): Promise<void> {
            return Promise.resolve();
        }
    },
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: class StdioServerTransportStub {},
}));

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

const MINE: CatalogBuildingView = {
    type: BuildingType.Mine,
    onChainId: 4,
    radius: 0,
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
    radius: 0,
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
    radius: 0,
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
    radius: 0,
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
        usdg: '0xusdg',
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
    reveal: { ethBudget: '0.001', cpuBurn: '2' },
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

function withMill(building: Partial<CatalogBuildingView>, recipe: Partial<RecipeView> = {}): AppConfig {
    return {
        ...CONFIG,
        buildings: CONFIG.buildings.map((entry) =>
            entry.type === BuildingType.SteelMill ? ({ ...entry, ...building } as CatalogBuildingView) : entry,
        ),
        recipes: CONFIG.recipes.map((entry) => ({ ...entry, ...recipe })),
    };
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

    it('prices a cycle at what the craft actually burns — the recipe base plus the opex on top', async () => {
        const operation = section(await card(BuildingType.SteelMill), 'Operation');

        expect(operation).toContain('30s');
        expect(operation).toContain('3 $CPU base + 2 $CPU opex = 5 $CPU/cycle');
    });

    it('never declares a paid recipe free when this building adds no opex to it', async () => {
        const freeOpex = withMill({ recipeOpexCpu: { smelt_steel: '0' } });

        const operation = section(await card(BuildingType.SteelMill, freeOpex), 'Operation');

        expect(operation).toContain('3 $CPU/cycle');
        expect(operation).not.toMatch(/\b0 \$CPU\/cycle/);
        expect(operation).not.toMatch(/free/i);
    });

    it('says the opex is unpriced rather than zero when the config serves none', async () => {
        const unpriced = withMill({ recipeOpexCpu: null });

        const operation = section(await card(BuildingType.SteelMill, unpriced), 'Operation');

        expect(operation).toContain('3 $CPU base');
        expect(operation).toMatch(/not priced here/i);
        expect(operation).not.toContain('= 3 $CPU/cycle');
    });

    it('keeps a free recipe free instead of pricing it at zero', async () => {
        const free = withMill({ recipeOpexCpu: { smelt_steel: '0' } }, { costCpu: '0' });

        const operation = section(await card(BuildingType.SteelMill, free), 'Operation');

        expect(operation).toContain('free');
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

    it('keeps both price terms and their sum in the machine block', async () => {
        const mill = await machineBlock(BuildingType.SteelMill);
        const [recipe] = (mill.operation as Record<string, unknown>).recipes as Array<Record<string, unknown>>;

        expect(recipe?.costCpu).toBe('3');
        expect(recipe?.opexCpu).toBe('2');
        expect(recipe?.totalCpu).toBe('5');
    });

    it('leaves the total unknown rather than guessing it when no opex is served', async () => {
        const unpriced = withMill({ recipeOpexCpu: null });
        const result = await register(unpriced).call({ buildingType: BuildingType.SteelMill });
        const card = JSON.parse(result.content[1]?.text ?? '{}') as Record<string, unknown>;
        const [recipe] = (card.operation as Record<string, unknown>).recipes as Array<Record<string, unknown>>;

        expect(recipe?.costCpu).toBe('3');
        expect(recipe?.opexCpu).toBeNull();
        expect(recipe?.totalCpu).toBeNull();
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

describe('building role summary', () => {
    it('tells an extractor what it mines', () => {
        expect(summarizeBuildingRole(MINE, CONFIG.recipes, CONFIG.resources)).toBe('mines Iron, Copper');
    });

    it('tells a crafter what it produces, never what it swallows', () => {
        const summary = summarizeBuildingRole(STEEL_MILL, CONFIG.recipes, CONFIG.resources);

        expect(summary).toBe('crafts Steel');
        expect(summary).not.toContain('Iron');
    });

    it('tells a hub what it routes rather than what it mines', () => {
        const summary = summarizeBuildingRole(HUB, CONFIG.recipes, CONFIG.resources);

        expect(summary).toMatch(/routes/i);
        expect(summary).not.toMatch(/mine|craft/i);
    });

    it('rides on the first line of the card', async () => {
        const [headline] = (await card(BuildingType.SteelMill)).split('\n');

        expect(headline).toContain('Steel Mill');
        expect(headline).toContain('crafts Steel');
    });
});

describe('server registration', () => {
    it('registers the card tool on the server the client connects to', async () => {
        sdk.toolNames.length = 0;

        await createServer({ config: { OPERATOR_PERSONA: true } } as unknown as AppContext);

        expect(sdk.toolNames).toContain('cpu_get_building');
    });
});
