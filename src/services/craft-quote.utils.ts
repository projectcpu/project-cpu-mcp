import { FULL_INPUT_PERCENT } from './craft-quote.constants.js';
import type { CatalogBuildingView } from './types.js';
import type { CraftStackView, RecipeView } from '../api/types.js';

export function effectiveCraftInputs(
    recipe: Pick<RecipeView, 'inputs'>,
    building: Pick<CatalogBuildingView, 'effects'>,
    batches: number,
): Array<CraftStackView> {
    return recipe.inputs.map((input) => {
        const percent =
            building.effects.inputEfficiency.find((effect) => effect.resourceId === input.resourceId)?.percent ??
            FULL_INPUT_PERCENT;
        return {
            resourceId: input.resourceId,
            amount: Math.floor((input.amount * percent) / FULL_INPUT_PERCENT) * batches,
        };
    });
}
