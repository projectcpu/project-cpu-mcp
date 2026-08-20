import { z } from 'zod';

import { type AttentionItem, AttentionSeverity } from '../../../map/types.js';
import type { ResourceNames } from '../../../utils/format.utils.js';

export const getAttentionInputSchema = {
    minSeverity: z
        .nativeEnum(AttentionSeverity)
        .nullable()
        .default(null)
        .describe('Only return items at or above this urgency (critical > warning > info). Default: all.'),
    owner: z
        .string()
        .nullable()
        .default(null)
        .describe(
            'Scout another player: their wallet address to inspect their cells (read-only intel — the map is ' +
                'public). Omit to get your own to-do list. Deliveries are only surfaced for yourself.',
        ),
};

export interface WarehousePressureInput {
    scouting: boolean;
    owner: string | null;
    ownerKnown: boolean;
    version: number;
    counts: Record<AttentionSeverity, number>;
    items: ReadonlyArray<AttentionItem>;
    note: string | null;
    resources: ResourceNames;
}
