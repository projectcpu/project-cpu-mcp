import { describe, expect, it } from 'vitest';

import {
    BuildingKind,
    type BuildingType,
    type CraftRecipeId,
    type CraftStackView,
    RandomnessKind,
    type RecipeView,
} from '../../../api/types.js';
import { Network } from '../../../config/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { type AppConfig, type CatalogBuildingView, ModeSwitchKind } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerGetGameConfigTool } from '../get-game-config/get-game-config.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

const STATIC_CHAR_BUDGET = 8_000;

const PER_BUILDING_CHAR_BUDGET = 160;

const CATALOG_DUMP_SHRINK_FACTOR = 3;

const RESOURCE_NAMES = [
    'Water',
    'Sand',
    'Crude Oil',
    'Iron Ore',
    'Tungsten Ore',
    'Bauxite',
    'Copper Ore',
    'Coal',
    'Limestone',
    'Rare Earths',
    'Concrete',
    'Steel',
    'Wiring',
    'Heatsinks',
    'Chemicals',
    'Compounds',
    'Silicon',
    'Chips',
    'Memory',
    'Cooling Units',
    'Accelerators',
    'Network Gear',
    'Fuel Rods',
    'Energy',
    'Plastics',
    'Glass',
    'Ceramics',
    'Aluminium',
    'Copper Wire',
    'Circuit Boards',
    'Sensors',
    'Actuators',
    'Optics',
    'Batteries',
    'Turbines',
    'Casings',
    'Fasteners',
    'Lubricants',
    'Coolant',
    'Solvents',
];

const FAMILY_NAMES = [
    'pump_station',
    'quarry',
    'derrick',
    'mine',
    'tungsten_drill',
    'bauxite_pit',
    'copper_mine',
    'coal_pit',
    'limestone_quarry',
    'rare_earth_mine',
    'concrete_plant',
    'steel_mill',
    'wiring_shop',
    'heatsink_forge',
    'chemical_works',
    'compound_lab',
    'silicon_furnace',
    'chip_fab',
    'memory_fab',
    'cooling_works',
    'accelerator_plant',
    'hub',
];

const CATALOG_BUILDING_COUNT = 108;

const RECIPE_COUNT = 16;

function titleize(type: string): string {
    return type
        .split('_')
        .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
        .join(' ');
}

function resourceIds(): Array<number> {
    return RESOURCE_NAMES.map((_, index) => index + 1);
}

function catalogResources(): Record<number, string> {
    return Object.fromEntries(RESOURCE_NAMES.map((name, index) => [index + 1, name]));
}

function stacks(seed: number, count: number): Array<CraftStackView> {
    return Array.from({ length: count }, (_, index) => ({
        resourceId: ((seed + index * 7) % RESOURCE_NAMES.length) + 1,
        amount: 1 + ((seed + index) % 9),
    }));
}

function catalogRecipes(): Array<RecipeView> {
    return Array.from({ length: RECIPE_COUNT }, (_, index) => ({
        id: `catalog_recipe_${index + 1}` as CraftRecipeId,
        name: `Catalog Recipe ${index + 1}`,
        tier: 1 + (index % 5),
        inputs: stacks(index, 2),
        outputs: stacks(index + 3, 1),
        durationSec: 30 + index * 15,
        costCpu: `${index}`,
    }));
}

function buildingKindFor(familyIndex: number): BuildingKind {
    if (familyIndex === FAMILY_NAMES.length - 1) {
        return BuildingKind.Hub;
    }
    return familyIndex < 10 ? BuildingKind.Extractor : BuildingKind.Crafter;
}

function catalogBuilding(
    familyIndex: number,
    level: number,
    branch: string | null,
    recipes: Array<RecipeView>,
): CatalogBuildingView {
    const family = FAMILY_NAMES[familyIndex] ?? 'unknown_family';
    const kind = buildingKindFor(familyIndex);
    const type = level === 1 ? family : `${family}_branch_${branch ?? 'a'}_l${level}`;
    const own = recipes[familyIndex % recipes.length];
    const spare = recipes[(familyIndex + 5) % recipes.length];
    const runs = kind === BuildingKind.Crafter && own !== undefined && spare !== undefined ? [own.id, spare.id] : [];
    return {
        type: type as BuildingType,
        onChainId: familyIndex * 10 + level,
        name: titleize(type),
        kind,
        tier: level,
        buildCost: `${25 * level * (familyIndex + 1)}`,
        buildTimeSec: 120 * level,
        buildInputs: level === 1 ? [] : stacks(familyIndex + level, 2),
        demolishCost: { cpu: `${12 * level}`, inputs: stacks(familyIndex, 1) },
        modeSwitchCost: '1',
        modeSwitch: { kind: ModeSwitchKind.Possible, costCpu: '1' },
        minableResources: kind === BuildingKind.Extractor ? [familyIndex + 1, familyIndex + 2, familyIndex + 3] : [],
        recipes: runs,
        effects: {
            cycleTimeBp: 10_000 - level * 500,
            extractionShareBp: 10_000 + level * 250,
            inputEfficiency: stacks(familyIndex, 2).map((stack) => ({
                resourceId: stack.resourceId,
                percent: 90 + stack.amount,
            })),
        },
        recipeOpexCpu: runs.length > 0 ? Object.fromEntries(runs.map((id) => [id, `${level}`])) : null,
        upgradeFrom: level === 1 ? null : level === 2 ? (family as BuildingType) : `${family}_branch_${branch}_l2`,
        upgradeTo:
            level === 1
                ? [`${family}_branch_a_l2`, `${family}_branch_b_l2`]
                : level === 2
                  ? [`${family}_branch_${branch}_l3`]
                  : [],
        family,
        level,
        branch,
    };
}

function catalogBuildings(recipes: Array<RecipeView>): Array<CatalogBuildingView> {
    const all: Array<CatalogBuildingView> = [];
    for (let familyIndex = 0; familyIndex < FAMILY_NAMES.length; familyIndex += 1) {
        all.push(catalogBuilding(familyIndex, 1, null, recipes));
        for (const branch of ['a', 'b']) {
            all.push(catalogBuilding(familyIndex, 2, branch, recipes));
            all.push(catalogBuilding(familyIndex, 3, branch, recipes));
        }
    }
    return all.slice(0, CATALOG_BUILDING_COUNT);
}

function catalogScaleConfig(): AppConfig {
    const recipes = catalogRecipes();
    return {
        network: Network.ROBINHOOD,
        chainId: 4663,
        contracts: {
            land: '0x1111111111111111111111111111111111111111',
            cpuToken: '0x2222222222222222222222222222222222222222',
            cpuHook: '0x3333333333333333333333333333333333333333',
            cell: '0x4444444444444444444444444444444444444444',
            cellLens: '0x5555555555555555555555555555555555555555',
            transport: '0x6666666666666666666666666666666666666666',
            trade: '0x7777777777777777777777777777777777777777',
            syndicate: '0x8888888888888888888888888888888888888888',
        },
        randomness: { kind: RandomnessKind.ENTROPY, adapter: '0x00000000000000000000000000000000000000a1' },
        resources: catalogResources(),
        recipes,
        buildings: catalogBuildings(recipes),
        reveal: { ethContribution: '0.001', cpuBurn: '2' },
        transport: {
            moveRadius: 1,
            hubRadius: 3,
            moveTimePerCellSec: 60,
            moveFeeFloors: Object.fromEntries(resourceIds().map((id) => [id, `0.${id}`])),
        },
        trade: { saleBurnPercent: 1, maxSaleFeePercent: 50 },
        storage: {
            caps: resourceIds().map((id) => ({ resourceId: id, cellCap: id * 100, hubCap: id * 1000 })),
        },
    };
}

function capture(config: AppConfig): (args: never) => Promise<ToolResult> {
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

async function answerSize(config: AppConfig): Promise<number> {
    const result = await capture(config)({} as never);
    return result.content.reduce((total, block) => total + block.text.length, 0);
}

describe('get_game_config tool — the size of the answer at catalog scale', () => {
    it('fits a budget that grows with the catalog by an index row, not by a card', async () => {
        const config = catalogScaleConfig();
        expect(config.buildings).toHaveLength(CATALOG_BUILDING_COUNT);

        const size = await answerSize(config);

        expect(size).toBeLessThan(STATIC_CHAR_BUDGET + PER_BUILDING_CHAR_BUDGET * config.buildings.length);
    });

    it('stays a fraction of the raw catalog it indexes', async () => {
        const config = catalogScaleConfig();

        const size = await answerSize(config);

        expect(size).toBeLessThan(JSON.stringify(config.buildings).length / CATALOG_DUMP_SHRINK_FACTOR);
    });

    it('grows by roughly one index row per building added, not by a whole card', async () => {
        const config = catalogScaleConfig();
        const trimmed: AppConfig = { ...config, buildings: config.buildings.slice(0, config.buildings.length - 10) };

        const growth = (await answerSize(config)) - (await answerSize(trimmed));

        expect(growth).toBeGreaterThan(0);
        expect(growth).toBeLessThan(10 * PER_BUILDING_CHAR_BUDGET);
    });
});
