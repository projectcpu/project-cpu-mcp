import { describe, expect, it, vi } from 'vitest';

import { BuildingKind, BuildingType, CraftRecipeId, RandomnessKind } from '../../../api/types.js';
import { Network } from '../../../config/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { createServer } from '../../../server.js';
import { type AppConfig, type CatalogBuildingView, ModeSwitchKind } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerFindBuildingsTool } from '../find-buildings/find-buildings.js';
import { renderBuildingIndexLine } from '../find-buildings/find-buildings.utils.js';
import type { FindBuildingsArgs } from '../find-buildings/types.js';

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

type FindArgs = Partial<FindBuildingsArgs>;

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
    minableResources: [5],
    upgradeFrom: BuildingType.Mine,
    upgradeTo: [],
    level: 2,
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
    buildInputs: [{ resourceId: 101, amount: 2 }],
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
};

const COPPER_SMELTER: CatalogBuildingView = {
    ...STEEL_MILL,
    type: BuildingType.CopperSmelter,
    onChainId: 12,
    radius: 0,
    name: 'Copper Smelter',
    tier: 2,
    buildCost: '18',
    buildInputs: [{ resourceId: 5, amount: 4 }],
};

const HEATSINK_PLANT: CatalogBuildingView = {
    ...STEEL_MILL,
    type: BuildingType.HeatsinkPlant,
    onChainId: 13,
    radius: 0,
    name: 'Heatsink Plant',
    tier: 3,
    buildCost: '40',
    buildInputs: [{ resourceId: 5, amount: 9 }],
    recipes: [CraftRecipeId.MakeHeatsinks],
    recipeOpexCpu: { make_heatsinks: '1' },
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
    minableResources: [],
    modeSwitchCost: null,
    modeSwitch: { kind: ModeSwitchKind.Impossible },
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
    resources: { 5: 'Iron', 6: 'Copper', 101: 'Concrete', 102: 'Steel', 103: 'Heatsinks' },
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
        {
            id: CraftRecipeId.MakeHeatsinks,
            name: 'Make Heatsinks',
            tier: 3,
            inputs: [{ resourceId: 102, amount: 2 }],
            outputs: [{ resourceId: 103, amount: 1 }],
            durationSec: 60,
            costCpu: '4',
        },
    ],
    buildings: [MINE, MINE_L2, STEEL_MILL, COPPER_SMELTER, HEATSINK_PLANT, HUB],
    reveal: { ethContribution: '0.001', cpuBurn: '2' },
    transport: { moveRadius: 1, hubRadius: 3, moveTimePerCellSec: 2, moveFeeFloors: { 5: '0.1' } },
    trade: { saleBurnPercent: 1, maxSaleFeePercent: 50 },
    storage: { caps: [{ resourceId: 1, cellCap: 100, hubCap: 1000 }] },
};

interface RegisteredTool {
    name: string;
    description: string;
    inputKeys: Array<string>;
    call: (args: FindArgs) => Promise<ToolResult>;
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
            handler: (args: FindArgs) => Promise<ToolResult>,
        ): void {
            registered = {
                name,
                description: definition.description,
                inputKeys: Object.keys(definition.inputSchema),
                call: handler,
            };
        },
    } as unknown as ToolRegistrar;
    registerFindBuildingsTool(server, context);
    if (registered === null) {
        throw new Error('tool was not registered');
    }
    return registered;
}

const NO_FILTERS: FindBuildingsArgs = {
    buildInput: null,
    recipeInput: null,
    recipeOutput: null,
    minableResource: null,
    kind: null,
    tier: null,
    limit: null,
};

async function find(args: FindArgs, config: AppConfig = CONFIG): Promise<ToolResult> {
    return register(config).call({ ...NO_FILTERS, ...args });
}

async function text(args: FindArgs, config: AppConfig = CONFIG): Promise<string> {
    return (await find(args, config)).content[0]?.text ?? '';
}

async function machine(args: FindArgs, config: AppConfig = CONFIG): Promise<Record<string, unknown>> {
    const result = await find(args, config);
    return JSON.parse(result.content[1]?.text ?? '{}') as Record<string, unknown>;
}

async function types(args: FindArgs, config: AppConfig = CONFIG): Promise<Array<string>> {
    const found = (await machine(args, config)).buildings as Array<{ type: string }>;
    return found.map((building) => building.type);
}

function manyCrafters(count: number): AppConfig {
    const buildings = Array.from({ length: count }, (_, index) => ({
        ...STEEL_MILL,
        type: `mill_${index}` as BuildingType,
        onChainId: 200 + index,
        radius: 0,
        name: `Mill ${index}`,
    }));
    return { ...CONFIG, buildings: [...buildings, MINE, HUB] };
}

describe('find_buildings tool', () => {
    it('registers one search tool whose filters carry the canon names and no paging cursor', () => {
        const tool = register();

        expect(tool.name).toMatch(/^cpu_[a-z_]+$/);
        expect(tool.inputKeys).toEqual([
            'buildInput',
            'recipeInput',
            'recipeOutput',
            'minableResource',
            'kind',
            'tier',
            'limit',
        ]);
        expect(tool.inputKeys.join(' ')).not.toMatch(/cursor|offset|page|before|after/i);
    });

    it('answers a build-material question differently from a recipe-input question about one resource', async () => {
        const builtFromIron = await types({ buildInput: 5 });
        const fedIron = await types({ recipeInput: 5 });

        expect(builtFromIron).toEqual([BuildingType.CopperSmelter, BuildingType.HeatsinkPlant]);
        expect(fedIron).toEqual([BuildingType.SteelMill, BuildingType.CopperSmelter]);
    });

    it('filters by recipe product, by minable resource, by kind and by tier', async () => {
        expect(await types({ recipeOutput: 102 })).toEqual([BuildingType.SteelMill, BuildingType.CopperSmelter]);
        expect(await types({ minableResource: 5 })).toEqual([BuildingType.Mine, 'mine_l2']);
        expect(await types({ kind: BuildingKind.Crafter })).toEqual([
            BuildingType.SteelMill,
            BuildingType.CopperSmelter,
            BuildingType.HeatsinkPlant,
        ]);
        expect(await types({ tier: 1 })).toEqual([BuildingType.Mine, BuildingType.Hub]);
    });

    it('combines the filters by and, so every added one can only narrow the answer', async () => {
        expect(await types({ kind: BuildingKind.Crafter, tier: 2 })).toEqual([
            BuildingType.SteelMill,
            BuildingType.CopperSmelter,
        ]);
        expect(await machine({ kind: BuildingKind.Crafter, tier: 2, buildInput: 5 })).toMatchObject({ matchCount: 1 });
        expect(await types({ kind: BuildingKind.Hub, minableResource: 5 })).toEqual([]);
    });

    it('returns index rows rather than cards once more than one building matches', async () => {
        const rows = await text({ kind: BuildingKind.Crafter });

        expect(rows).not.toContain('Construction');
        expect(rows).not.toContain('Recipe inputs');
        expect(rows).toContain('steel_mill | Steel Mill | crafter | tier 2 | build 20 $CPU | crafts Steel');
        expect(rows).toContain('heatsink_plant | Heatsink Plant | crafter | tier 3 | build 40 $CPU | crafts Heatsinks');
    });

    it('carries what a building does on the row itself', async () => {
        const rows = await text({ minableResource: 5 });

        expect(rows).toContain('mines Iron, Copper');
        expect(rows).toContain('mines Iron');
    });

    it('renders the row of the index in exactly the form the search returns', () => {
        expect(renderBuildingIndexLine(MINE, CONFIG.recipes, CONFIG.resources)).toBe(
            'mine | Mine | extractor | tier 1 | build 5 $CPU | mines Iron, Copper',
        );
    });

    it('expands a single match into the full card so no second call is needed', async () => {
        const card = await text({ recipeOutput: 103 });
        const block = await machine({ recipeOutput: 103 });

        expect(card).toContain('Construction');
        expect(card).toContain('Operation');
        expect(card).toContain('Lifecycle');
        expect(card).toContain('Recipe inputs');
        expect(card).toContain('9 Iron');
        expect(block.card).not.toBeNull();
    });

    it('keeps the card out of a result of several matches', async () => {
        const block = await machine({ kind: BuildingKind.Crafter });

        expect(block.matchCount).toBe(3);
        expect(block.card).toBeNull();
    });

    it('reports an empty result as an answer rather than an error', async () => {
        const result = await find({ kind: BuildingKind.Hub, recipeInput: 5 });

        expect(result.content[0]?.text ?? '').toMatch(/no .*building/i);
        expect(await machine({ kind: BuildingKind.Hub, recipeInput: 5 })).toMatchObject({
            matchCount: 0,
            buildings: [],
            card: null,
        });
    });

    it('serves 50 rows by default and says the rest was cut instead of offering a page to turn', async () => {
        const config = manyCrafters(60);
        const block = await machine({ kind: BuildingKind.Crafter }, config);
        const rows = await text({ kind: BuildingKind.Crafter }, config);

        expect(block.matchCount).toBe(60);
        expect((block.buildings as Array<unknown>).length).toBe(50);
        expect(rows).toMatch(/narrow/i);
        expect(JSON.stringify(block)).not.toMatch(/cursor|nextPage|offset/i);
    });

    it('honours an explicit smaller result size', async () => {
        const block = await machine({ kind: BuildingKind.Crafter, limit: 2 }, manyCrafters(60));

        expect((block.buildings as Array<unknown>).length).toBe(2);
        expect(block.matchCount).toBe(60);
    });

    it('echoes the filters it applied so a narrow answer is never mistaken for the whole catalog', async () => {
        const rows = await text({ recipeInput: 5, kind: BuildingKind.Crafter });

        expect(rows).toContain('Iron');
        expect(rows).toMatch(/recipe input/i);
    });

    it('explains in its description how a build input differs from a recipe input', () => {
        const { description } = register();

        expect(description).toMatch(/build input/i);
        expect(description).toMatch(/recipe input/i);
        expect(description).toMatch(/once/i);
    });
});

describe('server registration', () => {
    it('registers the search tool on the server the client connects to', async () => {
        sdk.toolNames.length = 0;

        await createServer({ config: { OPERATOR_PERSONA: true } } as unknown as AppContext);

        expect(sdk.toolNames).toContain('cpu_find_buildings');
    });
});
