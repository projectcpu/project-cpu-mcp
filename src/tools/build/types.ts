import { z } from 'zod';

import { BuildingType } from '../../api/types.js';
import { tokenIdSchema } from '../../geometry/types.js';
import type { AppConfig, BuildResult, UpgradeResult } from '../../services/types.js';

export interface BuildPanelInput {
    result: BuildResult;
    config: AppConfig;
}

export interface UpgradePanelInput {
    result: UpgradeResult;
    config: AppConfig;
}

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

export const upgradeInputSchema = {
    tokenId: tokenIdSchema
        .transform(String)
        .describe('The tokenId of a revealed cell you own whose current building to upgrade.'),
    targetBuildingType: z
        .string()
        .min(1)
        .describe(
            'The exact catalog `type` of the upgrade target, resolved dynamically against the current building ' +
                'catalog (see cpu_get_game_config) — not a static list. Must have a predecessor: a base building ' +
                'with no predecessor belongs to cpu_build instead.',
        ),
};
