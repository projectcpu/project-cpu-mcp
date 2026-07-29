import { z } from 'zod';

import { MAX_BATCHES_PER_PROCESS } from '../../config/constants.js';
import { tokenIdSchema } from '../../geometry/types.js';

export const miningStatusInputSchema = {
    tokenId: tokenIdSchema.transform(String).describe('The tokenId of the cell to inspect mining for.'),
};

export const startMiningInputSchema = {
    tokenId: tokenIdSchema.transform(String).describe('The tokenId of a cell you own holding a finished extractor.'),
    targetResourceId: z
        .number()
        .int()
        .nullable()
        .default(null)
        .describe(
            'Resource id to extract — must be one the extractor can mine and have a live deposit on the cell. ' +
                'Omit (null) to auto-pick when the extractor mines a single resource.',
        ),
    batches: z
        .number()
        .int()
        .min(1)
        .max(MAX_BATCHES_PER_PROCESS)
        .describe(
            `How many cycles to run, 1..${MAX_BATCHES_PER_PROCESS}. The job stops itself after these — it ` +
                'never produces past them, so arriving late banks exactly what was scheduled, no more. There ' +
                'is no cancel: restarting costs a claim plus a new start. Read the cycle length from ' +
                'cpu_get_game_config and size the run to how long you want the cell committed.',
        ),
};

export const claimMiningInputSchema = {
    tokenId: tokenIdSchema
        .transform(String)
        .describe('The tokenId of a cell you own with an extractor, to bank its matured mining cycles.'),
};
