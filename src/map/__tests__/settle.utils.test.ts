import { describe, expect, it } from 'vitest';

import {
    makeCell,
    makeCraftProcess,
    makeMiningProcess,
    makeProjectionConfig,
    makeResource,
    makeStorage,
} from './fixtures.js';
import { BuildingType } from '../../api/types.js';
import { toCell } from '../cell-view.utils.js';
import { settleCell, takePerCycle, type SettleConfig } from '../settle.utils.js';
import type { Cell, RawCell, RawCellResource } from '../types.js';

const RESOURCE = 3;
const RECIPE = 'refine';
const DRILL = BuildingType.TungstenDrill;
const OUTPUTS = { [RECIPE]: [{ resourceId: RESOURCE, amount: 100 }] };

function config(overrides: Partial<SettleConfig> = {}): SettleConfig {
    return {
        craftOutputsByRecipe: OUTPUTS,
        extractionShareBpByBuilding: { [BuildingType.Mine]: 10000 },
        ...overrides,
    };
}

function cell(overrides: Partial<RawCell> = {}, resources: Array<RawCellResource> = []): Cell {
    return toCell(
        makeCell({
            building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: null, modeRecipeId: null },
            process: makeMiningProcess({ resource: RESOURCE, yieldPerCycle: 100 }),
            resources,
            ...overrides,
        }),
        0,
        makeProjectionConfig({ craftOutputsByRecipe: OUTPUTS }),
    );
}

const uncapped = (deposit: string) => [makeResource({ resourceId: RESOURCE, deposit, storage: null })];

const DRILL_CONFIG = config({ extractionShareBpByBuilding: { [DRILL]: 8000 } });
function drillCell(resources: Array<RawCellResource>): Cell {
    return cell({ building: { type: DRILL, buildFinishAt: null, modeResource: null, modeRecipeId: null } }, resources);
}

describe('takePerCycle', () => {
    it('reconstructs the take as the credit when the whole take is credited (10000 bp)', () => {
        expect(takePerCycle(3858, 10000)).toBe(3858);
    });

    it.each([
        [8000, 100, 125],
        [8000, 3858, 4823],
        [6500, 100, 154],
        [6500, 3858, 5936],
    ])('at %s bp share, a %s credit reconstructs a take of %s', (shareBp, credit, expected) => {
        expect(takePerCycle(credit, shareBp)).toBe(expected);
    });

    it('rounds the take up, so a broken invariant over-drains rather than mints supply', () => {
        expect(takePerCycle(100, 6500)).toBe(154);
    });
});

describe('settleCell mining', () => {
    it('settles every matured cycle when nothing else binds', () => {
        expect(settleCell(cell({}, uncapped('10000')), 5, config())).toEqual({
            settledBatches: 5,
            minedUnits: 500n,
            drainedUnits: 500n,
            depleted: false,
        });
    });

    it('takes the credit as the take at a full 10000 bp share', () => {
        expect(settleCell(cell({}, uncapped('250')), 5, config())).toEqual({
            settledBatches: 3,
            minedUnits: 250n,
            drainedUnits: 250n,
            depleted: true,
        });
    });

    it('drains more from the deposit than it credits, dividing the share exactly', () => {
        expect(settleCell(drillCell(uncapped('500')), 5, DRILL_CONFIG)).toEqual({
            settledBatches: 4,
            minedUnits: 400n,
            drainedUnits: 500n,
            depleted: true,
        });
    });

    it('drains the deposit to exactly zero on a partial final cycle', () => {
        expect(settleCell(drillCell(uncapped('300')), 5, DRILL_CONFIG)).toEqual({
            settledBatches: 3,
            minedUnits: 240n,
            drainedUnits: 300n,
            depleted: true,
        });
    });

    it('binds warehouse room on the credit, not the take', () => {
        const room = [
            makeResource({ resourceId: RESOURCE, deposit: '100000', storage: makeStorage({ used: '0', cap: '350' }) }),
        ];
        expect(settleCell(drillCell(room), 5, DRILL_CONFIG)).toEqual({
            settledBatches: 3,
            minedUnits: 300n,
            drainedUnits: 375n,
            depleted: false,
        });
    });

    it('binds the deposit on the take, not the credit', () => {
        expect(settleCell(drillCell(uncapped('250')), 5, DRILL_CONFIG)).toEqual({
            settledBatches: 2,
            minedUnits: 200n,
            drainedUnits: 250n,
            depleted: true,
        });
    });

    it('fails loudly for an extractor type missing from the config, instead of guessing a full share', () => {
        expect(() => settleCell(cell({}, uncapped('400')), 5, config({ extractionShareBpByBuilding: {} }))).toThrow(
            /extraction share/i,
        );
    });

    it('fails loudly when a mining cell carries no building', () => {
        expect(() => settleCell(cell({ building: null }, uncapped('400')), 5, config())).toThrow(/no building/i);
    });

    it('settles whole cycles only — room for a partial cycle banks nothing', () => {
        const tight = [
            makeResource({ resourceId: RESOURCE, deposit: '10000', storage: makeStorage({ used: '10', cap: '99' }) }),
        ];
        const s = settleCell(cell({}, tight), 5, config());
        expect(s.settledBatches).toBe(0);
        expect(s.minedUnits).toBe(0n);
    });

    it('takes the whole cycles the room admits and no more', () => {
        const room = [
            makeResource({ resourceId: RESOURCE, deposit: '10000', storage: makeStorage({ used: '0', cap: '250' }) }),
        ];
        expect(settleCell(cell({}, room), 5, config())).toEqual({
            settledBatches: 2,
            minedUnits: 200n,
            drainedUnits: 200n,
            depleted: false,
        });
    });

    it('banks nothing when no cycle has matured', () => {
        expect(settleCell(cell({}, uncapped('10000')), 0, config())).toEqual({
            settledBatches: 0,
            minedUnits: 0n,
            drainedUnits: 0n,
            depleted: false,
        });
    });

    it('banks nothing on an empty deposit', () => {
        expect(settleCell(cell({}, uncapped('0')), 5, config())).toEqual({
            settledBatches: 0,
            minedUnits: 0n,
            drainedUnits: 0n,
            depleted: true,
        });
    });
});

describe('settleCell craft', () => {
    it('takes the whole batches every output admits', () => {
        const room = [
            makeResource({ resourceId: RESOURCE, deposit: '0', storage: makeStorage({ used: '0', cap: '250' }) }),
        ];
        const crafting = cell({ process: makeCraftProcess({ recipeId: RECIPE }) }, room);
        expect(settleCell(crafting, 5, config()).settledBatches).toBe(2);
    });

    it('never depletes — a craft has no deposit to drain', () => {
        const crafting = cell({ process: makeCraftProcess({ recipeId: RECIPE }) }, uncapped('0'));
        expect(settleCell(crafting, 5, config())).toEqual({
            settledBatches: 5,
            minedUnits: 0n,
            drainedUnits: 0n,
            depleted: false,
        });
    });
});

describe('settleCell idle', () => {
    it('settles nothing on a cell with no process', () => {
        expect(settleCell(cell({ process: null }, uncapped('10000')), 5, config())).toEqual({
            settledBatches: 0,
            minedUnits: 0n,
            drainedUnits: 0n,
            depleted: false,
        });
    });
});
