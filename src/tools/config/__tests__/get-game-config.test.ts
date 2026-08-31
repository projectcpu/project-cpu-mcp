import { describe, expect, it } from 'vitest';

import { BuildingKind, BuildingType, CraftRecipeId, RandomnessKind } from '../../../api/types.js';
import { Network } from '../../../config/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { type AppConfig, type LotListingRulesView, ModeSwitchKind } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { transportInputSchema } from '../../transport/types.js';
import type { ToolRegistrar } from '../../types.js';
import { renderBuildingIndexLine } from '../find-buildings/find-buildings.utils.js';
import {
    BUILDING_INDEX_SECTION_TITLE,
    EMPTY_CATALOG_NOTE,
    ENTRY_POINT_LOOKUP,
    ROUTING_BUILDING_CARD_LINE,
    ROUTING_FIND_BUILDINGS_LINE,
    ROUTING_RECIPES_LINE,
    ROUTING_RESOURCE_LENS_LINE,
    ROUTING_SECTION_TITLE,
    ROUTING_UNKNOWN_ID_LINE,
    STATIC_SECTION_TITLE,
} from '../get-game-config/constants.js';
import { registerGetGameConfigTool } from '../get-game-config/get-game-config.js';
import type { GameConfigReferenceView } from '../get-game-config/types.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

const SECTION_TITLES = [ROUTING_SECTION_TITLE, STATIC_SECTION_TITLE, BUILDING_INDEX_SECTION_TITLE];

const RECIPE_ONLY_NUMBERS = {
    durationSec: 4703,
    costCpu: '5309',
    inputAmount: 6113,
    outputAmount: 7717,
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
    resources: { 5: 'Iron', 101: 'Concrete', 102: 'Steel' },
    recipes: [
        {
            id: CraftRecipeId.SmeltSteel,
            name: 'Smelt Steel',
            tier: 2,
            inputs: [{ resourceId: 5, amount: RECIPE_ONLY_NUMBERS.inputAmount }],
            outputs: [{ resourceId: 102, amount: RECIPE_ONLY_NUMBERS.outputAmount }],
            durationSec: RECIPE_ONLY_NUMBERS.durationSec,
            costCpu: RECIPE_ONLY_NUMBERS.costCpu,
        },
    ],
    buildings: [
        {
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
            upgradeTo: ['mine_branch_a_l2'],
            family: 'mine',
            level: 1,
            branch: null,
        },
        {
            type: BuildingType.SteelMill,
            onChainId: 11,
            radius: 0,
            name: 'Steel Mill',
            kind: BuildingKind.Crafter,
            tier: 2,
            buildCost: '20',
            buildTimeSec: 900,
            buildInputs: [{ resourceId: 101, amount: 3 }],
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
            radius: 0,
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
            upgradeTo: [],
            family: 'mine',
            level: 2,
            branch: 'a',
        },
    ],
    reveal: { ethContribution: '0.001', cpuBurn: '2' },
    transport: { moveRadius: 1, hubRadius: 3, moveTimePerCellSec: 2, moveFeeFloors: { 5: '0.1' } },
    trade: { saleBurnPercent: 1, maxSaleFeePercent: 50 },
    storage: { caps: [{ resourceId: 1, cellCap: 100, hubCap: 1000 }] },
};

const LOT_LISTING_RULES: LotListingRulesView = {
    minLotSharePercent: 0.1,
    maxLotSharePercent: 2,
    minUncappedLotValue: '10000',
    maxUncappedLotValue: '100000',
    maxLotsPerSellerHubResource: 5,
    minPricePerUnit: '0',
};

const LOT_LISTING_LINE_PREFIX = 'Lot listing:';

function LOT_LISTING_SECTION_OF(text: string): string {
    const line = text.split('\n').find((row) => row.startsWith(LOT_LISTING_LINE_PREFIX));
    if (line === undefined) {
        throw new Error(`no "${LOT_LISTING_LINE_PREFIX}" line in the entry point`);
    }
    return line;
}

function capture(
    config: AppConfig = CONFIG,
    lotListing: LotListingRulesView | null = LOT_LISTING_RULES,
): (args: never) => Promise<ToolResult> {
    const context = {
        appConfig: { load: async () => config },
        tradeRules: { loadLotListingRules: async () => lotListing },
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

async function prose(config: AppConfig = CONFIG): Promise<string> {
    return (await capture(config)({} as never)).content[0]?.text ?? '';
}

async function reference(config: AppConfig = CONFIG): Promise<GameConfigReferenceView> {
    const raw = (await capture(config)({} as never)).content[1]?.text ?? '{}';
    return JSON.parse(raw) as GameConfigReferenceView;
}

function registeredToolName(): string {
    let name = '';
    const server = {
        registerTool(toolName: string): void {
            name = toolName;
        },
    } as unknown as ToolRegistrar;
    registerGetGameConfigTool(server, {
        appConfig: { load: async () => CONFIG },
        tradeRules: { loadLotListingRules: async () => LOT_LISTING_RULES },
        logger: new NoopLogger(),
    } as unknown as AppContext);
    return name;
}

function hubTier(type: string, tier: number, radius: number): AppConfig['buildings'][number] {
    const [base] = CONFIG.buildings;
    if (base === undefined) {
        throw new Error('the fixture carries no catalog building to build a Hub tier from');
    }
    return { ...base, type: type as BuildingType, name: type, kind: BuildingKind.Hub, tier, radius };
}

const HUB_LADDER = [hubTier('hub', 1, 5), hubTier('hub_l3', 3, 13)];

function sectionOf(text: string, title: string): string {
    const start = text.indexOf(title);
    if (start < 0) {
        throw new Error(`the answer carries no section titled ${title}`);
    }
    const rest = text.slice(start + title.length);
    const following = SECTION_TITLES.map((other) => rest.indexOf(other))
        .filter((index) => index >= 0)
        .sort((a, b) => a - b);
    const next = following[0];
    return next === undefined ? rest : rest.slice(0, next);
}

function everyRecipeFact(config: AppConfig): Array<string> {
    return config.recipes.flatMap((recipe) => [
        recipe.id,
        recipe.name,
        `${recipe.durationSec}`,
        recipe.costCpu,
        ...[...recipe.inputs, ...recipe.outputs].map((stack) => `${stack.amount}`),
    ]);
}

function namesToken(haystack: string, token: string): boolean {
    return new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(haystack);
}

function indexRowFor(text: string, type: string): string {
    const row = sectionOf(text, BUILDING_INDEX_SECTION_TITLE)
        .split('\n')
        .find((line) => line.startsWith(`${type} |`));
    if (row === undefined) {
        throw new Error(`the building index carries no row for ${type}`);
    }
    return row;
}

function upgradeRelationsOf(config: AppConfig): Array<{ type: string; related: Array<string> }> {
    return config.buildings
        .map((building) => ({
            type: building.type,
            related: [...(building.upgradeFrom === null ? [] : [building.upgradeFrom]), ...building.upgradeTo],
        }))
        .filter((entry) => entry.related.length > 0);
}

describe('get_game_config tool — reveal payment', () => {
    it('never offers a free reveal, whatever the legs are priced at', async () => {
        const profiles: Array<AppConfig['reveal']> = [
            { ethContribution: '0.001', cpuBurn: '2' },
            { ethContribution: '0', cpuBurn: '2' },
            { ethContribution: '0.001', cpuBurn: '0' },
            null,
        ];

        for (const reveal of profiles) {
            const text = await prose({ ...CONFIG, reveal });

            expect(text).toContain('Reveal: every reveal');
            expect(text).not.toMatch(/free reveal|reveal (is |)free|first reveal free|re-reveal/i);
        }
    });

    it('prints the reveal legs a live stand serves, without rescaling either of them', async () => {
        const text = await prose({ ...CONFIG, reveal: { ethContribution: '0.0001', cpuBurn: '1' } });

        expect(text).toContain('contributes 0.0001 ETH to the $CPU liquidity pool and burns 1 $CPU');
        expect(text).toContain('this view omits the live randomness fee and metadata publication charge');
        expect(text).toContain('cpu_reveal reads the exact total off the chain and pays that');
    });

    it('says the amounts are unknown, not zero, when the network serves no reveal payment', async () => {
        const text = await prose({ ...CONFIG, reveal: null });

        expect(text).toContain('this network serves no price for it, so the amounts are unknown here');
        expect(text).toContain('`cpu_reveal` reads the exact total off the chain and pays that');
    });
});

describe('get_game_config tool — randomness', () => {
    it('tells a push network that the draw arrives on its own and fulfilment is not the agent’s job', async () => {
        const text = await prose();

        expect(text).toContain('Randomness: push —');
        expect(text).toContain('deposits land asynchronously');
        expect(text).toContain('has nothing to do on this network');
        expect(text).not.toContain('self-service');
    });

    it('tells a self-service network that reveal finishes the draw itself and what fulfilled: false means', async () => {
        const text = await prose({
            ...CONFIG,
            randomness: {
                kind: RandomnessKind.DRAND,
                adapter: '0x00000000000000000000000000000000000000a2',
                genesis: 1_700_000_000,
                period: 30,
                beaconApi: 'https://beacon.example/v2',
            },
        });

        expect(text).toContain('Randomness: self-service —');
        expect(text).toContain('`fulfilled: false`');
        expect(text).toContain('call `cpu_reveal` on that cell again');
        expect(text).not.toContain('Randomness: push');
    });

    it('carries the randomness descriptor itself in the machine block', async () => {
        expect((await reference()).randomness).toEqual({
            kind: 'entropy',
            adapter: '0x00000000000000000000000000000000000000a1',
        });
    });
});

describe('get_game_config tool — the static every agent reads once', () => {
    it('keeps the network, contracts, resources, trade, transit and storage facts in the static section', async () => {
        const text = await prose();
        const section = sectionOf(text, STATIC_SECTION_TITLE);

        expect(text).toMatch(/Network robinhood \(chainId 4663\)/);
        expect(section).toContain('5:Iron');
        expect(section).toContain('101:Concrete');
        expect(section).toContain('USDG 0xusdg');
        expect(section).toContain('cell 0x5555555555555555555555555555555555555555');
        expect(section).toContain('transport 0x7777777777777777777777777777777777777777');
        expect(section).toContain('1% sale burn');
        expect(section).toContain(
            'sale fee up to 100% (the structural bound — a hub owner can set any rate up to this maximum)',
        );
        expect(section).toContain('radii in cells — move 1 everywhere; hub reach is set per Hub tier —');
        expect(section).toContain('3 by default for a tier without its own');
        expect(section).toContain('2s per cell');
        expect(section).toContain("every resource carries a transit-fee floor ($CPU/u; a hub's non-zero override");
        expect(section).toContain('5:0.1');
        expect(section).toContain('storage caps are explicit per-resource cell/hub shelf pairs');
        expect(section).toContain('`0` means unlimited');
    });

    it('serves the radius of every Hub tier, so hops can be chained without a code runner', async () => {
        const section = sectionOf(await prose({ ...CONFIG, buildings: HUB_LADDER }), STATIC_SECTION_TITLE);

        expect(section).toContain('hub reach is set per Hub tier — hub:5, hub_l3:13');
        expect(section).toContain('3 by default for a tier without its own');
    });

    it('holds the static and not the index rows or the routing map', async () => {
        const section = sectionOf(await prose(), STATIC_SECTION_TITLE);

        expect(section).not.toContain(ENTRY_POINT_LOOKUP.building);
        expect(section).not.toContain(ENTRY_POINT_LOOKUP.buildingSearch);
        expect(section).not.toContain('| crafter | tier 2 |');
    });

    it('serves every Hub tier radius in the machine block, not one universal hub radius', async () => {
        const json = await reference({ ...CONFIG, buildings: HUB_LADDER });

        expect(json.transport.hubRadii).toEqual([
            { type: 'hub', tier: 1, radius: 5 },
            { type: 'hub_l3', tier: 3, radius: 13 },
        ]);
        expect(json.transport.hubRadius).toBe(CONFIG.transport.hubRadius);
    });

    it('reads the tier radii off the loaded catalog instead of a ladder baked into the client', async () => {
        const json = await reference({ ...CONFIG, buildings: [hubTier('hub', 1, 7), hubTier('hub_l2', 2, 9)] });

        expect(json.transport.hubRadii).toEqual([
            { type: 'hub', tier: 1, radius: 7 },
            { type: 'hub_l2', tier: 2, radius: 9 },
        ]);
    });

    it('keeps buildings that route nothing out of the tier radii', async () => {
        const json = await reference();

        expect(CONFIG.buildings.map((building) => building.kind)).not.toContain(BuildingKind.Hub);
        expect(json.transport.hubRadii).toEqual([]);
    });

    it('is the tool a hand-planned hop is sent to for tier reach, and it answers with that reach', async () => {
        const json = await reference({ ...CONFIG, buildings: HUB_LADDER });
        const pathDescription = transportInputSchema.path.description ?? '';

        expect(json.transport.hubRadii).toHaveLength(HUB_LADDER.length);
        expect(pathDescription).toMatch(/radius of every Hub tier|Hub tier.*radius/);
        expect(pathDescription).toContain(registeredToolName());
    });

    it('carries every static group in the machine block, untrimmed', async () => {
        const json = await reference();

        expect(json.network).toBe('robinhood');
        expect(json.chainId).toBe(4663);
        expect(json.contracts).toEqual(CONFIG.contracts);
        expect(json.resources).toEqual({ 5: 'Iron', 101: 'Concrete', 102: 'Steel' });
        expect(json.reveal).toEqual({ ethContribution: '0.001', cpuBurn: '2' });
        expect(json.transport).toEqual({ ...CONFIG.transport, hubRadii: [] });
        expect(json.trade).toEqual({ saleBurnPercent: 1, maxSaleFeePercent: 50, lotListing: LOT_LISTING_RULES });
        expect(json.storage).toEqual({ caps: [{ resourceId: 1, cellCap: 100, hubCap: 1000 }] });
    });
});

describe('get_game_config tool — the building index', () => {
    it('carries one row per catalog building in the shape the search returns', async () => {
        const section = sectionOf(await prose(), BUILDING_INDEX_SECTION_TITLE);

        for (const building of CONFIG.buildings) {
            expect(section).toContain(renderBuildingIndexLine(building, CONFIG.recipes, CONFIG.resources));
        }
        expect(section).toContain('mine | Mine | extractor | tier 1 | build 5 $CPU | mines Iron');
        expect(section).toContain('steel_mill | Steel Mill | crafter | tier 2 | build 20 $CPU | crafts Steel');
    });

    it('says how many buildings the catalog holds', async () => {
        const text = await prose();

        expect(text).toContain(`${BUILDING_INDEX_SECTION_TITLE} (3 building(s))`);
    });

    it('holds rows and neither the static nor the routing map', async () => {
        const section = sectionOf(await prose(), BUILDING_INDEX_SECTION_TITLE);

        expect(section).toContain('mine | Mine | extractor');
        expect(section).not.toContain('Reveal: every reveal');
        expect(section).not.toContain('Contracts —');
        expect(section).not.toContain(ENTRY_POINT_LOOKUP.recipes);
    });

    it('carries no card fields: no build time, no demolish cost, no upgrade links, no effects', async () => {
        const section = sectionOf(await prose(), BUILDING_INDEX_SECTION_TITLE);

        expect(section).not.toMatch(/build 120s|build 300s/);
        expect(section).not.toContain('demolish');
        expect(section).not.toContain('predecessor');
        expect(section).not.toContain('successors');
        expect(section).not.toContain('cycleTimeBp');
        expect(section).not.toContain('extractionShareBp');
    });

    it('answers an empty catalog with a note rather than a bare heading', async () => {
        const text = await prose({ ...CONFIG, buildings: [] });

        expect(text).toContain(EMPTY_CATALOG_NOTE);
    });
});

describe('get_game_config tool — the routing map', () => {
    it('names a tool for each of the four directions', async () => {
        const section = sectionOf(await prose(), ROUTING_SECTION_TITLE);

        expect(section).toContain(ROUTING_BUILDING_CARD_LINE);
        expect(section).toContain(ROUTING_FIND_BUILDINGS_LINE);
        expect(section).toContain(ROUTING_RESOURCE_LENS_LINE);
        expect(section).toContain(ROUTING_RECIPES_LINE);
        expect(ROUTING_BUILDING_CARD_LINE).toContain(ENTRY_POINT_LOOKUP.building);
        expect(ROUTING_FIND_BUILDINGS_LINE).toContain(ENTRY_POINT_LOOKUP.buildingSearch);
        expect(ROUTING_RESOURCE_LENS_LINE).toContain(ENTRY_POINT_LOOKUP.resource);
        expect(ROUTING_RECIPES_LINE).toContain(ENTRY_POINT_LOOKUP.recipes);
    });

    it('sends upgrade relations to the building card, since the entry point no longer draws them', async () => {
        const section = sectionOf(await prose(), ROUTING_SECTION_TITLE);

        expect(section).toContain('upgrade');
        expect(section).toContain(ENTRY_POINT_LOOKUP.building);
    });

    it('warns that the two lookups answer an unknown id differently', async () => {
        const section = sectionOf(await prose(), ROUTING_SECTION_TITLE);

        expect(section).toContain(ROUTING_UNKNOWN_ID_LINE);
        expect(ROUTING_UNKNOWN_ID_LINE).toContain('`inCatalog: false`');
        expect(ROUTING_UNKNOWN_ID_LINE).toContain('throws');
    });

    it('repeats the same four tool names in the machine block', async () => {
        expect((await reference()).lookup).toEqual({
            building: 'cpu_get_building',
            buildingSearch: 'cpu_find_buildings',
            resource: 'cpu_get_resource',
            recipes: 'cpu_list_recipes',
        });
    });

    it('holds the routing map and neither the static nor the index rows', async () => {
        const section = sectionOf(await prose(), ROUTING_SECTION_TITLE);

        expect(section).not.toContain('Contracts —');
        expect(section).not.toContain('Reveal: every reveal');
        expect(section).not.toContain('| extractor | tier 1 |');
    });
});

describe('get_game_config tool — what it stopped carrying', () => {
    it('draws no upgrade graph anywhere in the answer', async () => {
        const result = await capture()({} as never);
        const whole = result.content.map((block) => block.text).join('\n');

        expect(whole).not.toContain('Upgrade graph');
        expect(whole).not.toContain('predecessor');
        expect(whole).not.toContain('successors');
        expect(whole).not.toContain('base building');
        expect(whole).not.toContain('cycleTimeBp');
    });

    it('points at the recipe tool instead of copying a single recipe line', async () => {
        const result = await capture()({} as never);
        const whole = result.content.map((block) => block.text).join('\n');

        expect(whole).toContain(ENTRY_POINT_LOOKUP.recipes);
        expect(whole).not.toContain('smelt_steel');
        expect(whole).not.toContain('$CPU/cycle');
        expect(whole).not.toContain('30s/cycle');
        expect(whole).not.toContain('Smelt Steel');
    });

    it('keeps full building cards out of the machine block', async () => {
        const result = await capture()({} as never);
        const raw = result.content[1]?.text ?? '';
        const json = JSON.parse(raw) as Record<string, unknown>;

        expect('buildings' in json).toBe(false);
        expect('recipes' in json).toBe(false);
        expect(raw).not.toContain('buildTimeSec');
        expect(raw).not.toContain('demolishCost');
        expect(raw).not.toContain('minableResources');
        expect(raw).not.toContain('recipeOpexCpu');
        expect(raw).not.toContain('durationSec');
    });

    it('carries no field of any configured recipe, whatever wording or key it is dressed in', async () => {
        const result = await capture()({} as never);
        const whole = result.content.map((block) => block.text).join('\n');
        const facts = everyRecipeFact(CONFIG);

        expect(facts.length).toBeGreaterThan(0);
        for (const fact of facts) {
            expect(whole).not.toContain(fact);
        }
    });

    it('names no upgrade relation on the row of the building that carries it', async () => {
        const text = await prose();
        const relations = upgradeRelationsOf(CONFIG);

        expect(relations.length).toBeGreaterThan(0);
        for (const { type, related } of relations) {
            const tail = indexRowFor(text, type).slice(type.length);
            for (const other of related) {
                expect(namesToken(tail, other)).toBe(false);
            }
        }
    });

    it('carries no catalog building type in the machine block, so no relation can hide under a key', async () => {
        const raw = (await capture()({} as never)).content[1]?.text ?? '';

        expect(CONFIG.buildings.length).toBeGreaterThan(0);
        for (const building of CONFIG.buildings) {
            expect(namesToken(raw, building.type)).toBe(false);
        }
    });

    it('still says how much of each the catalog holds, so nothing looks lost', async () => {
        expect((await reference()).catalog).toEqual({ buildingCount: 3, recipeCount: 1 });
    });
});

describe('cpu_get_game_config lot listing rules', () => {
    it('carries the live shares, uncapped bounds and per-seller limit in the machine block', async () => {
        expect((await reference()).trade.lotListing).toEqual(LOT_LISTING_RULES);
    });

    it('states the bounds as shares of the hub shelf, in percent, not in basis points', async () => {
        const text = await prose();

        expect(text).toMatch(/0\.1%/);
        expect(text).toMatch(/2%/);
        expect(text).not.toMatch(/\b10 bp\b/);
        expect(text).not.toMatch(/\b200 bp\b/);
    });

    it('states the uncapped absolute pair in resource units and says it applies to uncapped storage only', async () => {
        const text = await prose();

        expect(text).toMatch(/10000/);
        expect(text).toMatch(/100000/);
        expect(text).toMatch(/uncapped/i);
    });

    it('states the maximum live lots one seller may hold per hub and resource', async () => {
        expect(await prose()).toMatch(/5 live lots per seller, hub and resource/);
    });

    it('counts delivering, open and evicted lots against that limit', async () => {
        expect(LOT_LISTING_SECTION_OF(await prose())).toMatch(/delivering, open and evicted ones all count/i);
    });

    it('presents no flat minimum lot value as the rule for a capped resource', async () => {
        const listing = LOT_LISTING_SECTION_OF(await prose());

        expect(listing).toMatch(/of the hub's storage shelf/i);
        expect(listing).not.toMatch(/minimum lot value/i);
    });

    it('sends the agent to the Trade views for the effective units of one hub and resource', async () => {
        const listing = LOT_LISTING_SECTION_OF(await prose());

        expect(listing).toMatch(/read from the Trade contract itself/i);
        expect(listing).toMatch(/never worked out from these shares/i);
    });

    it('says the listing rules are unavailable rather than inventing them when the chain cannot be read', async () => {
        const text = (await capture(CONFIG, null)({} as never)).content[0]?.text ?? '';
        const listing = LOT_LISTING_SECTION_OF(text);

        expect(listing).toMatch(/could not be read right now/i);
        expect(listing).toMatch(/no wallet configured, or the chain is unreachable/i);
        expect(listing).toMatch(/retry/i);
        expect(listing).not.toMatch(/\d/);
        expect(listing).not.toMatch(/%/);
        expect(text).not.toMatch(/5 live lots/);
    });

    it('reports the absent rules as null in the machine block, never as zeros', async () => {
        const raw = (await capture(CONFIG, null)({} as never)).content[1]?.text ?? '{}';
        const view = JSON.parse(raw) as GameConfigReferenceView;

        expect(view.trade.lotListing).toBeNull();
    });
});
