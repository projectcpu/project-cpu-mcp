import { z } from 'zod';

import type { BuildingKind } from '../../../api/types.js';
import type { ModeSwitchView } from '../../../services/types.js';

export const getBuildingInputSchema = {
    buildingType: z
        .string()
        .min(1)
        .describe('The catalog `type` of the building, e.g. `steel_mill`, as `cpu_get_game_config` lists it.'),
};

export interface LabeledResourceView {
    resourceId: number;
    resourceName: string;
}

export interface LabeledStackView extends LabeledResourceView {
    amount: number;
}

export interface BuildingConstructionView {
    costCpu: string;
    buildTimeSec: number;
    buildInputs: Array<LabeledStackView>;
}

export interface BuildingRecipePlanView {
    id: string;
    name: string | null;
    durationSec: number | null;
    costCpu: string | null;
    opexCpu: string | null;
    recipeInputs: Array<LabeledStackView>;
    recipeOutputs: Array<LabeledStackView>;
}

export interface BuildingEffectsCardView {
    cycleTimePercent: number;
    extractionSharePercent: number;
    recipeInputEfficiency: Array<LabeledResourceView & { percent: number }>;
}

export interface BuildingOperationView {
    kind: BuildingKind;
    recipes: Array<BuildingRecipePlanView>;
    minableResources: Array<LabeledResourceView>;
    consumesRecipeInputs: boolean;
    effects: BuildingEffectsCardView;
}

export interface BuildingDemolishView {
    costCpu: string;
    inputs: Array<LabeledStackView>;
}

export interface BuildingLifecycleView {
    demolish: BuildingDemolishView;
    modeSwitch: ModeSwitchView;
    upgradeFrom: string | null;
    upgradeTo: Array<string>;
}

export interface BuildingCardView {
    type: string;
    name: string;
    kind: BuildingKind;
    tier: number;
    summary: string;
    construction: BuildingConstructionView;
    operation: BuildingOperationView;
    lifecycle: BuildingLifecycleView;
}
