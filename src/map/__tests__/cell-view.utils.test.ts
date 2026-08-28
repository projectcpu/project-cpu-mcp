import { describe, expect, it } from 'vitest';

import { BuildingType } from '../../api/types.js';
import { toCell } from '../cell-view.utils.js';
import {
    CellProcessKind,
    type CellProjectionConfig,
    type RawCell,
    type RawCellProcessView,
    type RawCellResource,
    type RawCellResourceStorage,
} from '../types.js';

const BASE_CAP = '100';
const HUB_CAP = '1000';
const FINISH_AT = 1000;
const RECIPE = 'alloy';
const YIELD_PER_CYCLE = 77;
const CRAFT_OUTPUT_PER_CYCLE = 40;

const UPGRADED_HUB = 'hub_l2a';

function config(overrides: Partial<CellProjectionConfig> = {}): CellProjectionConfig {
    return {
        hubBuildingTypes: new Set<string>([BuildingType.Hub]),
        upgradeFromByBuildingType: { [BuildingType.Hub]: null },
        craftOutputsByRecipe: {
            [RECIPE]: [
                { resourceId: 5, amount: CRAFT_OUTPUT_PER_CYCLE },
                { resourceId: 6, amount: CRAFT_OUTPUT_PER_CYCLE },
            ],
        },
        storageCapsByResource: {
            1: { cellCap: BigInt(BASE_CAP), hubCap: BigInt(HUB_CAP) },
            5: { cellCap: BigInt(BASE_CAP), hubCap: BigInt(HUB_CAP) },
            6: { cellCap: BigInt(BASE_CAP), hubCap: BigInt(HUB_CAP) },
        },
        ...overrides,
    };
}

function storage(overrides: Partial<RawCellResourceStorage> = {}): RawCellResourceStorage {
    return {
        used: '0',
        cellCap: BASE_CAP,
        hubCap: HUB_CAP,
        reserved: { incomingTransport: '0', lots: '0' },
        ...overrides,
    };
}

function resource(overrides: Partial<RawCellResource> = {}): RawCellResource {
    return { resourceId: 1, deposit: '0', balance: '0', strength: null, storage: storage(), ...overrides };
}

function mining(resourceId: number): RawCellProcessView {
    return {
        kind: CellProcessKind.Mining,
        resource: resourceId,
        durationSec: 180,
        yieldPerCycle: YIELD_PER_CYCLE,
        processDrawPerCycle: YIELD_PER_CYCLE,
        batches: 10,
        claimedBatches: 0,
        startAt: 0,
    };
}

function craft(recipeId: string = RECIPE): RawCellProcessView {
    return { kind: CellProcessKind.Craft, recipeId, batches: 1, claimedBatches: 0, durationSec: 60, startAt: 0 };
}

function rawCell(overrides: Partial<RawCell> = {}): RawCell {
    return {
        tokenId: '1',
        owner: '0xowner',
        revealCount: 1,
        revealPending: false,
        resources: [],
        building: null,
        demolishFinishAt: null,
        demolishStartAt: null,
        demolishingType: null,
        transitFeeOverrides: null,
        saleFeeOverrides: null,
        process: null,
        updated: 1,
        ...overrides,
    };
}

function hub(buildFinishAt: number | null = FINISH_AT): RawCell['building'] {
    return { type: BuildingType.Hub, buildFinishAt, modeResource: null, modeRecipeId: null };
}

describe('toCell readiness', () => {
    it.each([
        ['a bare cell has nothing to be ready', null, FINISH_AT, null],
        ['a building under construction is not ready', hub(), FINISH_AT - 1, false],
        ['a building is ready exactly at its finish time', hub(), FINISH_AT, true],
        ['a building is ready after its finish time', hub(), FINISH_AT + 1, true],
        ['a building with no finish time is already up', hub(null), 0, true],
    ])('%s', (_name, building, serverTime, expected) => {
        expect(toCell(rawCell({ building }), serverTime, config()).ready).toBe(expected);
    });

    it('judges readiness against the passed clock only — the same cell answers differently as it advances', () => {
        const cell = rawCell({ building: hub() });
        expect(toCell(cell, FINISH_AT - 1, config()).ready).toBe(false);
        expect(toCell(cell, FINISH_AT, config()).ready).toBe(true);
    });
});

describe('toCell active hub', () => {
    it.each([
        ['a bare cell is not an active hub', null, FINISH_AT, false],
        ['a hub under construction is not yet active', hub(), FINISH_AT - 1, false],
        ['a finished hub is active', hub(), FINISH_AT, true],
        [
            'a finished non-hub building is ready but not a hub',
            { type: BuildingType.Quarry, buildFinishAt: FINISH_AT, modeResource: null, modeRecipeId: null },
            FINISH_AT,
            false,
        ],
    ])('%s', (_name, building, serverTime, expected) => {
        expect(toCell(rawCell({ building }), serverTime, config()).activeHub).toBe(expected);
    });

    it('counts every hub kind the catalog names, so an upgraded hub is active too', () => {
        const cell = rawCell({
            building: { type: UPGRADED_HUB, buildFinishAt: FINISH_AT, modeResource: null, modeRecipeId: null },
        });
        const catalog = config({ hubBuildingTypes: new Set<string>([BuildingType.Hub, UPGRADED_HUB]) });
        expect(toCell(cell, FINISH_AT, catalog).activeHub).toBe(true);
    });
});

describe('toCell storage cap', () => {
    it.each([
        ['serves the base cap when the cell has no building', null, FINISH_AT, BASE_CAP],
        ['selects the hub shelf under an active hub', hub(), FINISH_AT, HUB_CAP],
        ['keeps the cell shelf while the first hub is still going up', hub(), FINISH_AT - 1, BASE_CAP],
        [
            'keeps the base cap under a finished non-hub building',
            { type: BuildingType.Quarry, buildFinishAt: FINISH_AT, modeResource: null, modeRecipeId: null },
            FINISH_AT,
            BASE_CAP,
        ],
    ])('%s', (_name, building, serverTime, expected) => {
        const cell = rawCell({ building, resources: [resource()] });
        expect(toCell(cell, serverTime, config()).resources[0]?.storage?.cap).toBe(expected);
    });

    it('keeps the hub shelf during a hub-to-hub upgrade without activating routing', () => {
        const building = {
            type: UPGRADED_HUB,
            buildFinishAt: FINISH_AT,
            modeResource: null,
            modeRecipeId: null,
        };
        const catalog = config({
            hubBuildingTypes: new Set<string>([BuildingType.Hub, UPGRADED_HUB]),
            upgradeFromByBuildingType: { [BuildingType.Hub]: null, [UPGRADED_HUB]: BuildingType.Hub },
        });
        const derived = toCell(rawCell({ building, resources: [resource()] }), FINISH_AT - 1, catalog);

        expect(derived.resources[0]?.storage?.cap).toBe(HUB_CAP);
        expect(derived.activeHub).toBe(false);
    });

    it('leaves an uncapped resource uncapped under an active hub', () => {
        const cell = rawCell({
            building: hub(),
            resources: [resource({ storage: storage({ cellCap: BASE_CAP, hubCap: null }) })],
        });
        expect(toCell(cell, FINISH_AT, config()).resources[0]?.storage?.cap).toBeNull();
    });

    it('selects an uncapped cell shelf without leaking the capped hub shelf', () => {
        const cell = rawCell({
            resources: [resource({ storage: storage({ cellCap: null, hubCap: HUB_CAP }) })],
        });
        const projected = toCell(cell, FINISH_AT, config()).resources[0]?.storage;

        expect(projected?.cap).toBeNull();
        expect(projected).not.toHaveProperty('cellCap');
        expect(projected).not.toHaveProperty('hubCap');
    });

    it('normalizes a null non-WCPU shelf to zero room rather than uncapped storage', () => {
        const cell = rawCell({
            resources: [resource({ resourceId: 5, storage: storage({ cellCap: null, hubCap: null }) })],
        });
        const projected = toCell(cell, FINISH_AT, config()).resources[0]?.storage;

        expect(projected).toMatchObject({ cap: '0', full: true });
    });

    it('leaves a resource with no warehouse alone', () => {
        const cell = rawCell({ building: hub(), resources: [resource({ storage: null })] });
        expect(toCell(cell, FINISH_AT, config()).resources[0]?.storage).toBeNull();
    });
});

describe('toCell full', () => {
    it.each([
        ['is full exactly at the cap', null, BASE_CAP, true],
        ['is not full one unit below the cap', null, '99', false],
        ['is not full at the cell cap once the hub shelf applies', hub(), BASE_CAP, false],
        ['is full at the hub cap', hub(), HUB_CAP, true],
        ['is full above the hub cap', hub(), '1001', true],
    ])('%s', (_name, building, used, expected) => {
        const cell = rawCell({ building, resources: [resource({ storage: storage({ used }) })] });
        expect(toCell(cell, FINISH_AT, config()).resources[0]?.storage?.full).toBe(expected);
    });

    it('never fills an uncapped resource, however much it holds', () => {
        const cell = rawCell({
            resources: [resource({ storage: storage({ cellCap: null, hubCap: null, used: '999999' }) })],
        });
        expect(toCell(cell, FINISH_AT, config()).resources[0]?.storage?.full).toBe(false);
    });
});

describe('toCell process stall', () => {
    it('stalls a mining process when its mined resource is full', () => {
        const cell = rawCell({
            resources: [resource({ deposit: '1000', storage: storage({ used: BASE_CAP }) })],
            process: mining(1),
        });
        expect(toCell(cell, FINISH_AT, config()).process?.stalled).toBe(true);
    });

    it('stalls a miner whose room holds less than one whole cycle, before the box reads full', () => {
        const used = String(Number(BASE_CAP) - YIELD_PER_CYCLE + 1);
        const cell = rawCell({
            resources: [resource({ deposit: '1000', storage: storage({ used }) })],
            process: mining(1),
        });
        const derived = toCell(cell, FINISH_AT, config());
        expect(derived.resources[0]?.storage?.full).toBe(false);
        expect(derived.process?.stalled).toBe(true);
    });

    it('keeps a miner running while the room still admits exactly one whole cycle', () => {
        const used = String(Number(BASE_CAP) - YIELD_PER_CYCLE);
        const cell = rawCell({
            resources: [resource({ deposit: '1000', storage: storage({ used }) })],
            process: mining(1),
        });
        expect(toCell(cell, FINISH_AT, config()).process?.stalled).toBe(false);
    });

    it('never stalls a miner on an uncapped resource', () => {
        const cell = rawCell({
            resources: [resource({ storage: storage({ cellCap: null, hubCap: null, used: '999999' }) })],
            process: mining(1),
        });
        expect(toCell(cell, FINISH_AT, config()).process?.stalled).toBe(false);
    });

    it('stalls a craft whose room holds less than one whole batch of an output', () => {
        const used = String(Number(BASE_CAP) - CRAFT_OUTPUT_PER_CYCLE + 1);
        const cell = rawCell({
            resources: [resource({ resourceId: 5, storage: storage({ used }) }), resource({ resourceId: 6 })],
            process: craft(),
        });
        expect(toCell(cell, FINISH_AT, config()).process?.stalled).toBe(true);
    });

    it('does not stall a mining process when an unrelated resource is full', () => {
        const cell = rawCell({
            resources: [resource({ resourceId: 2, storage: storage({ used: BASE_CAP }) }), resource()],
            process: mining(1),
        });
        expect(toCell(cell, FINISH_AT, config()).process?.stalled).toBe(false);
    });

    it('does not stall a mining process whose resource the cell does not hold', () => {
        const cell = rawCell({ resources: [], process: mining(1) });
        expect(toCell(cell, FINISH_AT, config()).process?.stalled).toBe(false);
    });

    it('stalls a craft when any one recipe output is full', () => {
        const cell = rawCell({
            resources: [resource({ resourceId: 5 }), resource({ resourceId: 6, storage: storage({ used: BASE_CAP }) })],
            process: craft(),
        });
        expect(toCell(cell, FINISH_AT, config()).process?.stalled).toBe(true);
    });

    it('groups duplicate recipe outputs before checking room for one whole batch', () => {
        const cell = rawCell({
            resources: [resource({ resourceId: 5, storage: storage({ used: '50' }) })],
            process: craft(),
        });
        const catalog = config({
            craftOutputsByRecipe: {
                [RECIPE]: [
                    { resourceId: 5, amount: 30 },
                    { resourceId: 5, amount: 30 },
                ],
            },
        });

        expect(toCell(cell, FINISH_AT, catalog).process?.stalled).toBe(true);
    });

    it('does not stall a craft while every recipe output has room', () => {
        const cell = rawCell({
            resources: [resource({ resourceId: 5 }), resource({ resourceId: 6 })],
            process: craft(),
        });
        expect(toCell(cell, FINISH_AT, config()).process?.stalled).toBe(false);
    });

    it('uses the configured shelf when the cell does not yet hold a craft output', () => {
        const cell = rawCell({ resources: [resource({ resourceId: 5 })], process: craft() });
        const catalog = config({
            storageCapsByResource: {
                5: { cellCap: BigInt(BASE_CAP), hubCap: BigInt(HUB_CAP) },
                6: { cellCap: 20n, hubCap: BigInt(HUB_CAP) },
            },
        });

        expect(toCell(cell, FINISH_AT, catalog).process?.stalled).toBe(true);
    });

    it('selects the Hub shelf for an absent craft output once the hub is Ready', () => {
        const cell = rawCell({ building: hub(), resources: [], process: craft() });
        const catalog = config({
            storageCapsByResource: {
                5: { cellCap: 20n, hubCap: BigInt(HUB_CAP) },
                6: { cellCap: 20n, hubCap: BigInt(HUB_CAP) },
            },
        });

        expect(toCell(cell, FINISH_AT - 1, catalog).process?.stalled).toBe(true);
        expect(toCell(cell, FINISH_AT, catalog).process?.stalled).toBe(false);
    });

    it('does not stall a process whose schedule is already spent', () => {
        const cell = rawCell({
            resources: [resource({ resourceId: 5, storage: storage({ used: BASE_CAP }) })],
            process: { ...craft(), batches: 1, claimedBatches: 1 },
        });

        expect(toCell(cell, FINISH_AT, config()).process?.stalled).toBe(false);
    });

    it('does not stall mining after the deposit is depleted', () => {
        const cell = rawCell({
            resources: [resource({ resourceId: 1, deposit: '0', storage: storage({ used: BASE_CAP }) })],
            process: mining(1),
        });

        expect(toCell(cell, FINISH_AT, config()).process?.stalled).toBe(false);
    });

    it('does not stall a craft whose recipe the config does not name', () => {
        const cell = rawCell({
            resources: [resource({ resourceId: 5, storage: storage({ used: BASE_CAP }) })],
            process: craft('unknown_recipe'),
        });
        expect(toCell(cell, FINISH_AT, config()).process?.stalled).toBe(false);
    });

    it('measures a craft stall against the hub shelf under an active hub', () => {
        const full = resource({ resourceId: 5, storage: storage({ used: BASE_CAP }) });
        const cell = rawCell({ building: hub(), resources: [full], process: craft() });
        expect(toCell(cell, FINISH_AT - 1, config()).process?.stalled).toBe(true);
        expect(toCell(cell, FINISH_AT, config()).process?.stalled).toBe(false);
    });
});

describe('toCell raw facts', () => {
    it('carries the raw facts through untouched, fee overrides included', () => {
        const cell = rawCell({
            building: hub(),
            transitFeeOverrides: { 5: '0.5' },
            saleFeeOverrides: { 5: 2.5 },
            demolishFinishAt: 42,
            demolishStartAt: 12,
            demolishingType: 'mine',
            updated: 7,
        });
        const derived = toCell(cell, FINISH_AT, config());
        expect(derived).toMatchObject({
            tokenId: '1',
            owner: '0xowner',
            transitFeeOverrides: { 5: '0.5' },
            saleFeeOverrides: { 5: 2.5 },
            demolishFinishAt: 42,
            demolishStartAt: 12,
            demolishingType: 'mine',
            updated: 7,
        });
    });

    it('does not mutate the raw cell it projects', () => {
        const cell = rawCell({ building: hub(), resources: [resource()] });
        toCell(cell, FINISH_AT, config());
        expect(cell.resources[0]?.storage?.cellCap).toBe(BASE_CAP);
        expect(cell).not.toHaveProperty('activeHub');
    });
});

describe('toCell double derivation', () => {
    it('refuses an already-derived cell, so the shelf cannot be selected twice', () => {
        const derived = toCell(rawCell({ building: hub(), resources: [resource()] }), FINISH_AT, config());
        // @ts-expect-error a derived cell is not a projectable raw cell
        expect(() => toCell(derived, FINISH_AT, config())).toBeDefined();
    });
});
