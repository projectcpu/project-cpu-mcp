import { z } from 'zod';

import { WITHDRAW_MAX_UNITS } from './constants.js';
import { tokenIdSchema } from '../../geometry/types.js';

export const withdrawInputSchema = {
    tokenId: tokenIdSchema.transform(String).describe('The tokenId of a cell you own holding wCPU to cash out.'),
    amount: z
        .string()
        .regex(/^\d+$/, 'amount must be a whole number of wCPU units (e.g. "100")')
        .refine((v) => {
            const units = BigInt(v);
            return units > 0n && units <= WITHDRAW_MAX_UNITS;
        }, `amount must be greater than 0 and at most ${WITHDRAW_MAX_UNITS.toString()}`)
        .describe(
            'How much wCPU (resource id 1) to convert to on-chain $CPU, 1:1, in whole units (e.g. "100"). ' +
                'Must be greater than 0 and at most the cell’s wCPU balance. See it with get_cell.',
        ),
};
