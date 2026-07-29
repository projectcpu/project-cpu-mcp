import { describe, expect, it } from 'vitest';

import { BuildingKind, CraftRecipeId } from '../../../api/types.js';
import { makeCell, makeProjectionConfig } from '../../../map/__tests__/fixtures.js';
import { toCell } from '../../../map/cell-view.utils.js';
import { type CatalogBuildingView, ModeSwitchKind } from '../../../services/types.js';
import { priceOutputs } from '../label.utils.js';

const UPGRADED_CRAFTER = 'oil_power_plant_l2a';

const catalogEntry: CatalogBuildingView = {
    type: UPGRADED_CRAFTER as CatalogBuildingView['type'],
    onChainId: 47,
    name: 'Oil Power Plant L2A',
    kind: BuildingKind.Crafter,
    tier: 2,
    buildCost: '85',
    buildTimeSec: 1560,
    buildInputs: [],
    demolishCost: { cpu: '42', inputs: [] },
    modeSwitchCost: null,
    modeSwitch: { kind: ModeSwitchKind.Impossible },
    minableResources: [],
    recipes: [CraftRecipeId.SmeltSteel],
    effects: { cycleTimeBp: 10000, extractionShareBp: 10000, inputEfficiency: [] },
    recipeOpexCpu: null,
};

function upgradedCraftCell() {
    const raw = makeCell({
        tokenId: '1',
        revealCount: 1,
        building: { type: UPGRADED_CRAFTER, buildFinishAt: null, modeResource: null, modeRecipeId: null },
    });
    return toCell(raw, 0, makeProjectionConfig());
}

describe('priceOutputs', () => {
    it('prices an upgraded building by matching its type against the catalog, not a fixed enum', () => {
        const outputs = priceOutputs(upgradedCraftCell(), [catalogEntry], {});
        expect(outputs).not.toBeNull();
        expect(outputs?.map((o) => o.recipeId)).toEqual([CraftRecipeId.SmeltSteel]);
    });

    it('returns null when the catalog names no building of the cell type', () => {
        expect(priceOutputs(upgradedCraftCell(), [], {})).toBeNull();
    });

    it('returns null for a cell with no building', () => {
        const bare = toCell(makeCell({ tokenId: '2', revealCount: 1 }), 0, makeProjectionConfig());
        expect(priceOutputs(bare, [catalogEntry], {})).toBeNull();
    });
});
