import { z } from 'zod';

export const mintInputSchema = {
    quantity: z
        .string()
        .regex(/^[1-9]\d*$/)
        .default('1')
        .describe('Number of land cells to mint, as a positive integer string (e.g. "1"). Default "1".'),
};

export const quoteMintInputSchema = mintInputSchema;
