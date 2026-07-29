import type { CraftRecipeId } from '../api/types.js';
import {
    type BuildingMode,
    type CatalogBuildingView,
    type CellOutputView,
    type ModeCostView,
    type ModeKey,
    ModeCostKind,
    ModeFreeReason,
    ModeSwitchKind,
} from '../services/types.js';
import { resourceName, type ResourceNames } from '../utils/format.utils.js';

export function buildingMode(building: { modeResource: number | null; modeRecipeId: string | null }): BuildingMode {
    return {
        resourceId: building.modeResource,
        recipeId: (building.modeRecipeId as CraftRecipeId | null) ?? null,
    };
}

export function modeCost(building: CatalogBuildingView | null, stored: ModeKey | null, target: ModeKey): ModeCostView {
    if (stored === null) {
        return { kind: ModeCostKind.Free, why: ModeFreeReason.FirstPick };
    }
    if (stored === target) {
        return { kind: ModeCostKind.Free, why: ModeFreeReason.SameOutput };
    }
    if (building === null) {
        return { kind: ModeCostKind.Unknown };
    }
    switch (building.modeSwitch.kind) {
        case ModeSwitchKind.Possible:
            return { kind: ModeCostKind.Paid, costCpu: building.modeSwitch.costCpu };
        case ModeSwitchKind.Unknown:
            return { kind: ModeCostKind.Unknown };
        case ModeSwitchKind.Impossible:
            return { kind: ModeCostKind.Unknown };
    }
}

export function outputsFor(
    building: CatalogBuildingView,
    mode: BuildingMode,
    resources: ResourceNames,
): Array<CellOutputView> {
    const mined = building.minableResources.map((resourceId) => ({
        resourceId,
        resourceName: resourceName(resources, resourceId),
        recipeId: null,
        cost: modeCost(building, mode.resourceId, resourceId),
    }));
    const crafted = building.recipes.map((recipeId) => ({
        resourceId: null,
        resourceName: null,
        recipeId,
        cost: modeCost(building, mode.recipeId, recipeId),
    }));
    return [...mined, ...crafted];
}
