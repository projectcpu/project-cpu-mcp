import { z } from 'zod';

import { DEFAULT_MATCH_LIMIT, MAX_MATCH_LIMIT } from './constants.js';
import { BuildingKind } from '../../../api/types.js';
import type { BuildingCardView } from '../building-card/types.js';

export const findBuildingsInputSchema = {
    buildInput: z
        .number()
        .int()
        .nullable()
        .default(null)
        .describe('Resource id burned once to construct the building. Not a recipe — see `recipeInput`.'),
    recipeInput: z
        .number()
        .int()
        .nullable()
        .default(null)
        .describe('Resource id a crafter consumes on every production cycle.'),
    recipeOutput: z
        .number()
        .int()
        .nullable()
        .default(null)
        .describe('Resource id a crafter produces on every production cycle.'),
    minableResource: z
        .number()
        .int()
        .nullable()
        .default(null)
        .describe('Resource id an extractor draws from the deposit of its cell.'),
    kind: z.nativeEnum(BuildingKind).nullable().default(null).describe('extractor | crafter | hub.'),
    tier: z.number().int().nullable().default(null).describe('Catalog tier of the building.'),
    limit: z
        .number()
        .int()
        .min(1)
        .max(MAX_MATCH_LIMIT)
        .nullable()
        .default(null)
        .describe(`How many rows to return (default ${DEFAULT_MATCH_LIMIT}, max ${MAX_MATCH_LIMIT}).`),
};

export interface FindBuildingsArgs {
    buildInput: number | null;
    recipeInput: number | null;
    recipeOutput: number | null;
    minableResource: number | null;
    kind: BuildingKind | null;
    tier: number | null;
    limit: number | null;
}

export interface BuildingIndexRowView {
    type: string;
    name: string;
    kind: BuildingKind;
    tier: number;
    buildCostCpu: string;
    summary: string;
}

export interface FindBuildingsResultView {
    filters: FindBuildingsArgs;
    matchCount: number;
    buildings: Array<BuildingIndexRowView>;
    card: BuildingCardView | null;
}
