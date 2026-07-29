import { z } from 'zod';

import { SwapToken } from '../../services/types.js';

const swapAmount = z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'amount must be a positive decimal string')
    .refine((v) => Number(v) > 0, 'amount must be greater than 0');

export const swapInputSchema = {
    sell: z.nativeEnum(SwapToken).describe('Token to spend: ETH (to buy $CPU) or CPU (to sell for ETH).'),
    amount: swapAmount.describe('Amount of the `sell` token to spend, as a decimal string (e.g. "0.5"). 18 decimals.'),
    slippage: z
        .number()
        .min(0)
        .max(50)
        .nullable()
        .default(0.5)
        .describe('Max slippage as a percent (e.g. 0.5 = 0.5%); the floor on what you receive. Default 0.5.'),
};

export const quoteSwapInputSchema = swapInputSchema;
