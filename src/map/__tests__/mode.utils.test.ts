import { describe, expect, it } from 'vitest';

import { BuildingType, CraftRecipeId } from '../../api/types.js';
import { makeConfig } from '../../services/__tests__/service-fakes.js';
import { type CatalogBuildingView, ModeSwitchKind } from '../../services/types.js';
import { buildingMode, modeCost, outputsFor } from '../mode.utils.js';

const RESOURCES = { 5: 'Iron', 6: 'Copper', 7: 'Water' };

function catalog(type: BuildingType): CatalogBuildingView {
    const row = makeConfig().buildings.find((b) => b.type === type);
    if (row === undefined) {
        throw new Error(`no catalog row for ${type}`);
    }
    return row;
}

const MINE = catalog(BuildingType.Mine);
const PUMP = catalog(BuildingType.PumpStation);
const FAB = catalog(BuildingType.WaferFab);

describe('modeCost', () => {
    it('prices the first pick after building as free', () => {
        expect(modeCost(MINE, null, 5)).toEqual({ kind: 'free', why: 'first_pick' });
    });

    it('prices restarting the same output as free, so a refilled deposit is never held back from', () => {
        expect(modeCost(MINE, 5, 5)).toEqual({ kind: 'free', why: 'same_output' });
    });

    it('prices a different output from the building’s own catalog row', () => {
        expect(modeCost(MINE, 5, 6)).toEqual({ kind: 'paid', costCpu: '1' });
        expect(modeCost(FAB, CraftRecipeId.SmeltSteel, CraftRecipeId.ForgeWcpu)).toEqual({
            kind: 'paid',
            costCpu: '22',
        });
    });

    it('never prices a row that can never switch', () => {
        expect(modeCost(PUMP, 7, 7)).toEqual({ kind: 'free', why: 'same_output' });
        expect(modeCost(PUMP, 7, 5)).toEqual({ kind: 'unknown' });
    });

    it('discloses an unknown price as unknown rather than as free or as impossible', () => {
        const unknown: CatalogBuildingView = { ...MINE, modeSwitch: { kind: ModeSwitchKind.Unknown } };

        expect(modeCost(unknown, 5, 6)).toEqual({ kind: 'unknown' });
    });

    it('falls back to unknown rather than free when there is no catalog row to price against', () => {
        expect(modeCost(null, 5, 6)).toEqual({ kind: 'unknown' });
        expect(modeCost(null, null, 6)).toEqual({ kind: 'free', why: 'first_pick' });
    });
});

describe('outputsFor', () => {
    it('enumerates only what the building can produce, priced against the mode it is on', () => {
        const outputs = outputsFor(MINE, { resourceId: 5, recipeId: null }, RESOURCES);

        expect(outputs).toEqual([
            { resourceId: 5, resourceName: 'Iron', recipeId: null, cost: { kind: 'free', why: 'same_output' } },
            { resourceId: 6, resourceName: 'Copper', recipeId: null, cost: { kind: 'paid', costCpu: '1' } },
        ]);
    });

    it('leaves a single-output extractor exactly one output and no price', () => {
        const outputs = outputsFor(PUMP, { resourceId: 7, recipeId: null }, RESOURCES);

        expect(outputs).toEqual([
            { resourceId: 7, resourceName: 'Water', recipeId: null, cost: { kind: 'free', why: 'same_output' } },
        ]);
    });

    it('enumerates a crafter by recipe', () => {
        const outputs = outputsFor(FAB, { resourceId: null, recipeId: CraftRecipeId.SmeltSteel }, RESOURCES);

        expect(outputs).toEqual([
            {
                resourceId: null,
                resourceName: null,
                recipeId: CraftRecipeId.SmeltSteel,
                cost: { kind: 'free', why: 'same_output' },
            },
            {
                resourceId: null,
                resourceName: null,
                recipeId: CraftRecipeId.ForgeWcpu,
                cost: { kind: 'paid', costCpu: '22' },
            },
        ]);
    });

    it('gives a hub no outputs at all', () => {
        expect(outputsFor(catalog(BuildingType.Hub), { resourceId: null, recipeId: null }, RESOURCES)).toEqual([]);
    });
});

describe('buildingMode', () => {
    it('reads a building that has never been pointed anywhere as no mode at all', () => {
        expect(buildingMode({ modeResource: null, modeRecipeId: null })).toEqual({ resourceId: null, recipeId: null });
    });

    it('carries the map’s raw mode fields through', () => {
        expect(buildingMode({ modeResource: 5, modeRecipeId: null })).toEqual({ resourceId: 5, recipeId: null });
        expect(buildingMode({ modeResource: null, modeRecipeId: 'smelt_steel' })).toEqual({
            resourceId: null,
            recipeId: CraftRecipeId.SmeltSteel,
        });
    });
});
