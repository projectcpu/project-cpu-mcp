import { z } from 'zod';

export const evictLotInputSchema = {
    lotId: z
        .string()
        .describe(
            'The id of the foreign lot to evict (from cpu_get_markets / cpu_list_lots / cpu_get_lot). It must be ' +
                'open, it must belong to someone else, and it must sit on a Hub you own. One lot per call.',
        ),
};
