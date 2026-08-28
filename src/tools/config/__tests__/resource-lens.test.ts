import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { BuildingKind, BuildingType, CraftRecipeId, RandomnessKind } from '../../../api/types.js';
import { Network } from '../../../config/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { createServer } from '../../../server.js';
import { type AppConfig, type CatalogBuildingView, ModeSwitchKind } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerGetResourceTool } from '../resource-lens/resource-lens.js';
import type { ResourceLensView } from '../resource-lens/types.js';

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

const KILN: CatalogBuildingView = {
    ...STEEL_MILL,
    type: 'kiln' as BuildingType,
    onChainId: 14,
    radius: 0,
    name: 'Kiln',
    tier: 2,
    buildCost: '25',
    buildInputs: [
        { resourceId: 201, amount: 7 },
        { resourceId: 202, amount: 2 },
    ],
    recipes: ['fire_ceramic' as CraftRecipeId],
    recipeOpexCpu: { fire_ceramic: '1' },
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
    resources: {
        1: 'WCPU',
        5: 'Iron',
        6: 'Copper',
        101: 'Concrete',
        102: 'Steel',
        103: 'Heatsinks',
        104: 'Slag',
        200: 'Ceramic',
        201: 'Flux',
        202: 'Sand',
    },
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
        {
            id: 'fire_ceramic' as CraftRecipeId,
            name: 'Fire Ceramic',
            tier: 2,
            inputs: [
                { resourceId: 202, amount: 11 },
                { resourceId: 201, amount: 3 },
            ],
            outputs: [
                { resourceId: 200, amount: 5 },
                { resourceId: 202, amount: 1 },
            ],
            durationSec: 45,
            costCpu: '2',
        },
    ],
    buildings: [MINE, MINE_L2, STEEL_MILL, COPPER_SMELTER, HEATSINK_PLANT, KILN, HUB],
    reveal: { ethBudget: '0.001', cpuBurn: '2' },
    transport: {
        moveRadius: 1,
        hubRadius: 3,
        moveTimePerCellSec: 2,
        moveFeeFloors: { 5: '0.1', 102: '0.25', 201: '0.75' },
    },
    trade: { saleBurnPercent: 1, maxSaleFeePercent: 50 },
    storage: {
        caps: [
            { resourceId: 1, cellCap: 0, hubCap: 0 },
            { resourceId: 5, cellCap: 100, hubCap: 1000 },
            { resourceId: 102, cellCap: 0, hubCap: 500 },
            { resourceId: 201, cellCap: 42, hubCap: 7 },
        ],
    },
};

interface RegisteredTool {
    name: string;
    description: string;
    inputKeys: Array<string>;
    call: (args: Record<string, unknown>) => Promise<ToolResult>;
    parseInput: (args: Record<string, unknown>) => unknown;
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
            definition: { description: string; inputSchema: z.ZodRawShape },
            handler: (args: never) => Promise<ToolResult>,
        ): void {
            const schema = z.object(definition.inputSchema);
            registered = {
                name,
                description: definition.description,
                inputKeys: Object.keys(definition.inputSchema),
                call: async (args) => handler(schema.parse(args) as never),
                parseInput: (args) => schema.parse(args),
            };
        },
    } as unknown as ToolRegistrar;
    registerGetResourceTool(server, context);
    if (registered === null) {
        throw new Error('tool was not registered');
    }
    return registered;
}

async function lookUp(resourceId: number, config: AppConfig = CONFIG): Promise<ToolResult> {
    return register(config).call({ resourceId });
}

async function text(resourceId: number, config: AppConfig = CONFIG): Promise<string> {
    return (await lookUp(resourceId, config)).content[0]?.text ?? '';
}

async function lens(resourceId: number, config: AppConfig = CONFIG): Promise<ResourceLensView> {
    const result = await lookUp(resourceId, config);
    return JSON.parse(result.content[1]?.text ?? '{}') as ResourceLensView;
}

const ROW_INDENT = '  ';

function groupRows(rendered: string, heading: RegExp): Array<string> {
    const lines = rendered.split('\n');
    const start = lines.findIndex((line) => heading.test(line));
    if (start < 0) {
        throw new Error(`the answer prints no heading matching ${String(heading)}`);
    }
    const rows: Array<string> = [];
    for (const line of lines.slice(start + 1)) {
        if (!line.startsWith(ROW_INDENT)) {
            break;
        }
        rows.push(line.slice(ROW_INDENT.length));
    }
    return rows;
}

function groupText(rendered: string, heading: RegExp): string {
    return groupRows(rendered, heading).join('\n');
}

describe('resource lens tool', () => {
    it('registers one lens tool keyed by a resource id and nothing else', () => {
        const tool = register();

        expect(tool.name).toMatch(/^cpu_[a-z_]+$/);
        expect(tool.inputKeys).toEqual(['resourceId']);
    });

    it('accepts the resource id through its own registered schema and rejects a non-id', () => {
        const tool = register();

        expect(tool.parseInput({ resourceId: 5 })).toEqual({ resourceId: 5 });
        expect(() => tool.parseInput({ resourceId: 'iron' })).toThrow();
        expect(() => tool.parseInput({ resourceId: 1.5 })).toThrow();
        expect(() => tool.parseInput({})).toThrow();
    });

    it('splits the four roles of one resource apart under the canon names', async () => {
        const iron = await lens(5);

        expect(iron.minedBy.map((row) => row.type)).toEqual([BuildingType.Mine, 'mine_l2']);
        expect(iron.buildInputTo.map((row) => row.type)).toEqual([
            BuildingType.CopperSmelter,
            BuildingType.HeatsinkPlant,
        ]);
        expect(iron.recipeInputTo.map((row) => row.id)).toEqual([CraftRecipeId.SmeltSteel]);
        expect(iron.recipeOutputOf).toEqual([]);
    });

    it('reads the same four roles from the other side for a crafted resource', async () => {
        const steel = await lens(102);

        expect(steel.minedBy).toEqual([]);
        expect(steel.buildInputTo.map((row) => row.type)).toEqual(['mine_l2']);
        expect(steel.recipeInputTo.map((row) => row.id)).toEqual([CraftRecipeId.MakeHeatsinks]);
        expect(steel.recipeOutputOf.map((row) => row.id)).toEqual([CraftRecipeId.SmeltSteel]);
    });

    it('puts a building that is both built out of the resource and eats it into both groups separately', async () => {
        const iron = await lens(5);
        const eaters = iron.recipeInputTo.flatMap((row) => row.buildings);

        expect(iron.buildInputTo.map((row) => row.name)).toContain('Copper Smelter');
        expect(eaters).toContain('Copper Smelter');
        expect(iron.buildInputTo.map((row) => row.name)).not.toContain('Steel Mill');
        expect(eaters).toContain('Steel Mill');
    });

    it('never merges the build role into the recipe role', async () => {
        const iron = await lens(5);

        expect(iron.buildInputTo.map((row) => row.name)).not.toContain('Mine');
        expect(iron.recipeInputTo.map((row) => row.buildings).flat()).not.toContain('Heatsink Plant');
    });

    it('carries the amount each role moves, so the two consumptions are never read as one', async () => {
        const iron = await lens(5);

        expect(iron.buildInputTo.map((row) => row.amount)).toEqual([4, 9]);
        expect(iron.recipeInputTo[0]?.amount).toBe(4);
    });

    it('carries the cell shelf, the hub shelf and the transit fee floor of the resource', async () => {
        const iron = await lens(5);
        const rendered = await text(5);

        expect(iron.storage).toEqual({ cellShelf: 100, hubShelf: 1000 });
        expect(iron.transitFeeFloorCpu).toBe('0.1');
        expect(rendered).toMatch(/cell shelf/i);
        expect(rendered).toMatch(/hub shelf/i);
        expect(rendered).toMatch(/transit fee floor/i);
        expect(rendered).toContain('0.1');
    });

    it('reads only WCPU zero shelves as unlimited', async () => {
        const wcpu = await text(1);
        const steel = await text(102);

        expect((await lens(1)).storage).toEqual({ cellShelf: 0, hubShelf: 0 });
        expect(wcpu).toMatch(/unlimited/i);
        expect(steel).toContain('Cell shelf: 0 units');
        expect(steel).not.toMatch(/unlimited/i);
    });

    it('answers a resource nothing touches with empty lists instead of an error', async () => {
        const result = await lookUp(104);
        const slag = await lens(104);

        expect(result.content[0]?.text ?? '').toContain('Slag');
        expect(slag).toMatchObject({
            minedBy: [],
            buildInputTo: [],
            recipeInputTo: [],
            recipeOutputOf: [],
            inCatalog: true,
        });
    });

    it('answers an id absent from the catalog rather than throwing, and says it is absent', async () => {
        const unknown = await lens(999);
        const rendered = await text(999);

        expect(unknown.inCatalog).toBe(false);
        expect(unknown.minedBy).toEqual([]);
        expect(rendered).toMatch(/cpu_get_game_config/);
    });

    it('prints every link by the name of the building or the recipe', async () => {
        const rendered = await text(5);

        expect(rendered).toContain('Mine');
        expect(rendered).toContain('Deep Mine');
        expect(rendered).toContain('Copper Smelter');
        expect(rendered).toContain('Heatsink Plant');
        expect(rendered).toContain('Smelt Steel');
    });

    it('labels the four groups apart in the text so neither consumption reads as the other', async () => {
        const rendered = await text(5);

        expect(rendered).toMatch(/mined by/i);
        expect(rendered).toMatch(/build input/i);
        expect(rendered).toMatch(/recipe input/i);
        expect(rendered).toMatch(/recipe output/i);
    });

    it('carries no trading data at all, in either half of the answer', async () => {
        const result = await lookUp(5);
        const whole = JSON.stringify(result);

        expect(whole).not.toMatch(/vwap/i);
        expect(whole).not.toMatch(/\bprice/i);
        expect(whole).not.toMatch(/\bvolume/i);
        expect(whole).not.toMatch(/\bbid\b|\bask\b|\blot\b/i);
    });

    it('says in its description that trading numbers live in their own tool', () => {
        const { description } = register();

        expect(description).toMatch(/cpu_get_market_index/);
        expect(description).toMatch(/resource/i);
    });

    it('needs no live read of its own — the loaded config is the whole answer', async () => {
        const sealed = new Proxy(
            { appConfig: { load: async () => CONFIG } },
            {
                get(target, property) {
                    if (property !== 'appConfig') {
                        throw new Error(`the lens reached past the loaded config for "${String(property)}"`);
                    }
                    return Reflect.get(target, property);
                },
            },
        ) as unknown as AppContext;
        let registered: ((args: never) => Promise<ToolResult>) | null = null;
        const server = {
            registerTool(_name: string, definition: { inputSchema: z.ZodRawShape }, handler: never): void {
                void z.object(definition.inputSchema);
                registered = handler;
            },
        } as unknown as ToolRegistrar;
        registerGetResourceTool(server, sealed);
        const call = registered as unknown as (args: unknown) => Promise<ToolResult>;

        await expect(call({ resourceId: 5 })).resolves.toBeDefined();
    });
});

describe('resource lens prose', () => {
    it('keeps every heading over its own rows, so a miner never reads as a build consumer', async () => {
        const rendered = await text(5);
        const mined = groupText(rendered, /^Mined by/);
        const built = groupText(rendered, /^Build input to/);

        expect(mined).toContain('Mine');
        expect(mined).toContain('Deep Mine');
        expect(mined).not.toContain('Copper Smelter');
        expect(mined).not.toContain('Heatsink Plant');
        expect(built).toContain('Copper Smelter');
        expect(built).toContain('Heatsink Plant');
        expect(built).not.toMatch(/\bMine\b/);
    });

    it('says on each heading what that role does to the resource', async () => {
        const rendered = await text(5);

        expect(rendered).toMatch(/^Mined by \(extractors that draw it from the deposit .*\):$/m);
        expect(rendered).toMatch(/^Build input to \(burned once to erect the building.*\):$/m);
        expect(rendered).toMatch(/^Recipe input to \(consumed by every production cycle\):$/m);
        expect(rendered).toMatch(/^Recipe output of \(produced by every production cycle\):$/m);
    });

    it('never prints a per-build amount on a mining row, because standing there burns nothing', async () => {
        const iron = await lens(5);

        expect(iron.minedBy.map((row) => row.amount)).toEqual([null, null]);
        expect(groupText(await text(5), /^Mined by/)).not.toMatch(/per build/);
    });

    it('prints how many units a build consumer burns, counting only its own stack of them', async () => {
        const iron = groupText(await text(5), /^Build input to/);
        const flux = groupText(await text(201), /^Build input to/);

        expect(iron).toContain('| 4 per build');
        expect(iron).toContain('| 9 per build');
        expect(flux).toContain('| 7 per build');
        expect(flux).not.toContain('9 per build');
        expect((await lens(201)).buildInputTo.map((row) => row.amount)).toEqual([7]);
    });

    it('names the buildings that actually run each recipe rather than a fixed list', async () => {
        const ironEaters = groupText(await text(5), /^Recipe input to/);
        const fluxEaters = groupText(await text(201), /^Recipe input to/);

        expect(ironEaters).toContain('run by Steel Mill, Copper Smelter');
        expect(fluxEaters).toContain('run by Kiln');
        expect(fluxEaters).not.toContain('Steel Mill');
    });

    it('counts only the stacks of the asked resource when a recipe carries several', async () => {
        const flux = await lens(201);
        const sand = await lens(202);
        const ceramic = await lens(200);

        expect(flux.recipeInputTo.map((row) => row.amount)).toEqual([3]);
        expect(sand.recipeInputTo.map((row) => row.amount)).toEqual([11]);
        expect(sand.recipeOutputOf.map((row) => row.amount)).toEqual([1]);
        expect(ceramic.recipeOutputOf.map((row) => row.amount)).toEqual([5]);
        expect(groupText(await text(202), /^Recipe input to/)).toContain('11 per cycle');
        expect(groupText(await text(202), /^Recipe output of/)).toContain('1 per cycle');
    });

    it('prints an empty group as "none" rather than as nothing at all', async () => {
        expect(groupRows(await text(5), /^Recipe output of/)).toEqual(['none']);
        expect(groupRows(await text(104), /^Mined by/)).toEqual(['none']);
    });

    it('tells the reader that a resource nothing touches is an answer and not a failure', async () => {
        const [headline, note] = (await text(104)).split('\n');

        expect(headline ?? '').toContain('Slag');
        expect(note ?? '').toMatch(/not an error/i);
    });

    it('gives each resource its own two shelves and never reports a real ceiling as unlimited', async () => {
        expect(groupRows(await text(5), /^Storage$/)).toEqual(['Cell shelf: 100 units', 'Hub shelf: 1000 units']);
        expect(groupRows(await text(201), /^Storage$/)).toEqual(['Cell shelf: 42 units', 'Hub shelf: 7 units']);
        expect(groupRows(await text(1), /^Storage$/)).toEqual(['Cell shelf: unlimited', 'Hub shelf: unlimited']);
        expect(groupRows(await text(102), /^Storage$/)).toEqual(['Cell shelf: 0 units', 'Hub shelf: 500 units']);
    });

    it('reports an absent shelf pair as absent rather than inventing one', async () => {
        expect((await lens(104)).storage).toBeNull();
        expect(groupRows(await text(104), /^Storage$/)).toEqual(['not listed in the loaded config']);
    });

    it('reads the transit floor of the asked resource and not of a neighbour', async () => {
        expect((await lens(5)).transitFeeFloorCpu).toBe('0.1');
        expect((await lens(102)).transitFeeFloorCpu).toBe('0.25');
        expect((await lens(201)).transitFeeFloorCpu).toBe('0.75');
        expect(groupText(await text(102), /^Transit$/)).toContain('0.25 $CPU per unit');
    });

    it('calls a missing transit floor unknown instead of quietly making it free', async () => {
        expect(groupRows(await text(104), /^Transit$/)).toEqual([
            'Transit fee floor: not listed in the loaded config — unknown, never free',
        ]);
        expect(groupText(await text(5), /^Transit$/)).toMatch(
            /^Transit fee floor: 0\.1 \$CPU per unit — .*override.*wins over it$/,
        );
    });
});

describe('server registration', () => {
    it('registers the resource lens on the server the client connects to', async () => {
        sdk.toolNames.length = 0;

        await createServer({ config: { OPERATOR_PERSONA: true } } as unknown as AppContext);

        expect(sdk.toolNames).toContain('cpu_get_resource');
    });
});
