import { z } from 'zod';

export const getChangesInputSchema = {
    sinceVersion: z
        .number()
        .int()
        .min(0)
        .nullable()
        .default(null)
        .describe('The "version" (epoch ms) from a previous map response. Omit or 0 to return every cell.'),
};
