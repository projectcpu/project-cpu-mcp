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
import { projectCellProcess } from '../process-projection.utils.js';
import type { Cell, CellProjectionConfig, RawCell, RawCellResource } from '../types.js';

const RESOURCE = 3;
const RECIPE = 'refine';
const DRILL = BuildingType.TungstenDrill;
const OUTPUTS = { [RECIPE]: [{ resourceId: RESOURCE, amount: 100 }] };

function config(overrides: Partial<CellProjectionConfig> = {}): CellProjectionConfig {
    return makeProjectionConfig({
        craftOutputsByRecipe: OUTPUTS,
        extractionShareBpByBuilding: { [BuildingType.Mine]: 10000 },
        ...overrides,
    });
}

function cell(
    overrides: Partial<RawCell> = {},
    resources: Array<RawCellResource> = [],
    projectionConfig: CellProjectionConfig = config(),
): Cell {
    return toCell(
        makeCell({
            building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: null, modeRecipeId: null },
            process: makeMiningProcess({ resource: RESOURCE, yieldPerCycle: 100, durationSec: 1 }),
            resources,
            ...overrides,
        }),
        0,
        projectionConfig,
    );
}

function projection(subject: Cell, serverTime: number, projectionConfig: CellProjectionConfig = config()) {
    const result = projectCellProcess(subject, serverTime, projectionConfig);
    if (result === null) {
        throw new Error('expected an active process projection');
    }
    return result;
}

const uncapped = (deposit: string) => [makeResource({ resourceId: RESOURCE, deposit, storage: null })];

function drillCell(resources: Array<RawCellResource>): Cell {
    const drillConfig = config({ extractionShareBpByBuilding: { [DRILL]: 8000 } });
    return cell(
        { building: { type: DRILL, buildFinishAt: null, modeResource: null, modeRecipeId: null } },
        resources,
        drillConfig,
    );
}

describe('process projection schedule and progress', () => {
    it('counts only whole cycles and exposes the next cycle boundary', () => {
        const subject = cell(
            {
                process: makeMiningProcess({
                    resource: RESOURCE,
                    yieldPerCycle: 100,
                    durationSec: 180,
                    batches: 10,
                    startAt: 1000,
                }),
            },
            uncapped('10000'),
        );

        expect(projection(subject, 1000 + 2 * 180 + 30).progress).toMatchObject({
            claimableBatches: 2,
            completedBatches: 2,
            endsAtSec: 2800,
            nextBatchAtSec: 1540,
        });
    });

    it('measures from an advanced cursor without subtracting claimed batches twice', () => {
        const subject = cell(
            {
                process: makeMiningProcess({
                    resource: RESOURCE,
                    yieldPerCycle: 100,
                    durationSec: 180,
                    batches: 10,
                    claimedBatches: 3,
                    startAt: 1540,
                }),
            },
            uncapped('10000'),
        );

        expect(projection(subject, 1900).progress).toMatchObject({
            claimableBatches: 2,
            completedBatches: 5,
            endsAtSec: 2800,
            nextBatchAtSec: 2080,
        });
    });

    it('clamps future cursors and never matures past the batches left', () => {
        const subject = cell(
            {
                process: makeMiningProcess({
                    resource: RESOURCE,
                    yieldPerCycle: 100,
                    durationSec: 180,
                    batches: 10,
                    claimedBatches: 8,
                    startAt: 1000,
                }),
            },
            uncapped('10000'),
        );

        expect(projection(subject, 500).progress.claimableBatches).toBe(0);
        expect(projection(subject, 999_000).progress.claimableBatches).toBe(2);
        expect(projection(subject, 999_000).progress.nextBatchAtSec).toBeNull();
    });

    it('accrues nothing for zero-duration and zero-batch legacy rows', () => {
        const zeroDuration = cell(
            {
                process: makeMiningProcess({ resource: RESOURCE, durationSec: 0, batches: 10 }),
            },
            uncapped('10000'),
        );
        const zeroBatches = cell(
            {
                process: makeMiningProcess({ resource: RESOURCE, durationSec: 180, batches: 0 }),
            },
            uncapped('10000'),
        );

        expect(projection(zeroDuration, 9999).progress.claimableBatches).toBe(0);
        expect(projection(zeroBatches, 9999).progress).toMatchObject({
            claimableBatches: 0,
            isFinished: true,
            nextBatchAtSec: null,
        });
    });

    it('keeps a room-blocked process unfinished with no next batch', () => {
        const blocked = cell({}, [
            makeResource({
                resourceId: RESOURCE,
                deposit: '10000',
                storage: makeStorage({ used: '10', cellCap: '99', hubCap: '99' }),
            }),
        ]);

        const stale = {
            ...blocked,
            process: blocked.process === null ? null : { ...blocked.process, stalled: false },
        };
        const result = projection(stale, 9999);
        expect(result.stalled).toBe(true);
        expect(result.progress).toMatchObject({
            completedBatches: 0,
            claimableBatches: 0,
            isFinished: false,
            nextBatchAtSec: null,
        });
        expect(result.warehouseEffects).toEqual([{ resourceId: RESOURCE, requiredPerBatch: 100n, blocked: true }]);
    });
});

describe('process projection mining settlement', () => {
    it('settles every matured cycle when nothing else binds', () => {
        expect(projection(cell({}, uncapped('10000')), 5).settlement).toEqual({
            settledBatches: 5,
            minedUnits: 500n,
            drainedUnits: 500n,
            depleted: false,
        });
    });

    it('reconstructs and rounds the deposit take from extraction share', () => {
        const drillConfig = config({ extractionShareBpByBuilding: { [DRILL]: 8000 } });
        expect(projection(drillCell(uncapped('500')), 5, drillConfig).settlement).toEqual({
            settledBatches: 4,
            minedUnits: 400n,
            drainedUnits: 500n,
            depleted: true,
        });
        expect(projection(drillCell(uncapped('300')), 5, drillConfig).settlement).toEqual({
            settledBatches: 3,
            minedUnits: 240n,
            drainedUnits: 300n,
            depleted: true,
        });
    });

    it('binds warehouse room on the credit and deposit on the take', () => {
        const drillConfig = config({ extractionShareBpByBuilding: { [DRILL]: 8000 } });
        const room = [
            makeResource({
                resourceId: RESOURCE,
                deposit: '100000',
                storage: makeStorage({ used: '0', cellCap: '350', hubCap: '350' }),
            }),
        ];
        expect(projection(drillCell(room), 5, drillConfig).settlement).toMatchObject({
            settledBatches: 3,
            minedUnits: 300n,
            drainedUnits: 375n,
        });
        expect(projection(drillCell(uncapped('250')), 5, drillConfig).settlement).toEqual({
            settledBatches: 2,
            minedUnits: 200n,
            drainedUnits: 250n,
            depleted: true,
        });
    });

    it('fails loudly when mining projection lacks its building configuration', () => {
        const subject = cell({}, uncapped('400'));
        expect(() => projection(subject, 5, config({ extractionShareBpByBuilding: {} }))).toThrow(/extraction share/i);
        expect(() => projection(cell({ building: null }, uncapped('400')), 5)).toThrow(/no building/i);
    });

    it('settles no partial warehouse cycle and depletes an empty deposit', () => {
        const tight = [
            makeResource({
                resourceId: RESOURCE,
                deposit: '10000',
                storage: makeStorage({ used: '10', cellCap: '99', hubCap: '99' }),
            }),
        ];
        expect(projection(cell({}, tight), 5).settlement).toMatchObject({ settledBatches: 0, minedUnits: 0n });
        expect(projection(cell({}, uncapped('0')), 5).settlement).toEqual({
            settledBatches: 0,
            minedUnits: 0n,
            drainedUnits: 0n,
            depleted: true,
        });
    });
});

describe('process projection craft settlement', () => {
    function crafting(resources: Array<RawCellResource>): Cell {
        return cell({ process: makeCraftProcess({ recipeId: RECIPE, durationSec: 1, batches: 10 }) }, resources);
    }

    it('settles the whole batches admitted by every output shelf', () => {
        const room = [
            makeResource({
                resourceId: RESOURCE,
                storage: makeStorage({ used: '0', cellCap: '250', hubCap: '250' }),
            }),
        ];
        expect(projection(crafting(room), 5).settlement.settledBatches).toBe(2);
    });

    it('never depletes because craft has no deposit to drain', () => {
        expect(projection(crafting(uncapped('0')), 5).settlement).toEqual({
            settledBatches: 5,
            minedUnits: 0n,
            drainedUnits: 0n,
            depleted: false,
        });
    });

    it('returns null for an idle cell', () => {
        expect(projectCellProcess(cell({ process: null }), 5, config())).toBeNull();
    });
});
