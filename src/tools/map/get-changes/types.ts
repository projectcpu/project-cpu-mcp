import { z } from 'zod';

import type { ServerHealthView } from '../../../api/types.js';
import type { MapChanges, MapReadiness } from '../../../map/types.js';

export const getChangesInputSchema = {
    sinceVersion: z
        .number()
        .int()
        .min(0)
        .nullable()
        .default(null)
        .describe('The "version" (epoch ms) from a previous map response. Omit or 0 to return every cell.'),
};

export interface ChangeFeedInput {
    since: number;
    changes: MapChanges;
    health: ServerHealthView;
    readiness: MapReadiness;
    socketConnected: boolean;
}
