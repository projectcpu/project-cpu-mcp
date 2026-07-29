import { z } from 'zod';

import { CraftRecipeId } from '../../api/types.js';
import { MAX_BATCHES_PER_PROCESS } from '../../config/constants.js';
import { tokenIdSchema } from '../../geometry/types.js';

export const craftInputSchema = {
    tokenId: tokenIdSchema.transform(String).describe('The tokenId of a cell you own to craft on.'),
    recipeId: z.nativeEnum(CraftRecipeId).describe('Which recipe to run — see list_recipes for inputs/outputs/cost.'),
    batches: z
        .number()
        .int()
        .min(1)
        .max(MAX_BATCHES_PER_PROCESS)
        .default(1)
        .describe(
            `How many sequential batches to run, 1..${MAX_BATCHES_PER_PROCESS}; inputs are debited upfront for ` +
                'all of them. The run stops itself after these and there is no cancel.',
        ),
};

export const craftCellInputSchema = {
    tokenId: tokenIdSchema.transform(String).describe('The tokenId of the cell whose craft processes to act on.'),
};
