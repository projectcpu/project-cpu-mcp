import { z } from 'zod';

import { BuildingType } from '../../api/types.js';
import { tokenIdSchema } from '../../geometry/types.js';

export const buildInputSchema = {
    tokenId: tokenIdSchema.transform(String).describe('The tokenId of a revealed cell you own to build on.'),
    buildingType: z
        .nativeEnum(BuildingType)
        .describe(
            'Which building to place — see cpu_get_game_config for the full catalog (kind, cost, mine/craft ' +
                'bindings). An extractor mines a deposit (then start it with cpu_start_mining), a crafter runs a ' +
                'recipe (cpu_craft), the hub routes transport and trade.',
        ),
};

export const demolishInputSchema = {
    tokenId: tokenIdSchema.transform(String).describe('The tokenId of a cell you own whose building to remove.'),
};
