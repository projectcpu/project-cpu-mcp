import { z } from 'zod';

import type { BuildingIndexRowView } from '../find-buildings/types.js';

export const getResourceInputSchema = {
    resourceId: z
        .number()
        .int()
        .describe('The catalog id of the resource, e.g. `102`, as `cpu_get_game_config` lists it.'),
};

export interface GetResourceArgs {
    resourceId: number;
}

export interface ResourceBuildingRowView extends BuildingIndexRowView {
    amount: number | null;
}

export interface ResourceRecipeRowView {
    id: string;
    name: string;
    amount: number;
    durationSec: number;
    buildings: Array<string>;
}

export interface ResourceStorageShelvesView {
    cellShelf: number;
    hubShelf: number;
}

export interface ResourceLensView {
    resourceId: number;
    resourceName: string;
    inCatalog: boolean;
    minedBy: Array<ResourceBuildingRowView>;
    buildInputTo: Array<ResourceBuildingRowView>;
    recipeInputTo: Array<ResourceRecipeRowView>;
    recipeOutputOf: Array<ResourceRecipeRowView>;
    storage: ResourceStorageShelvesView | null;
    transitFeeFloorCpu: string | null;
}
