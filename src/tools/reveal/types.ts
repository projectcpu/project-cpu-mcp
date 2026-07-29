import { z } from 'zod';

import { tokenIdSchema } from '../../geometry/types.js';

export const revealInputSchema = {
    tokenId: tokenIdSchema.transform(String).describe('The tokenId of a cell you own to reveal.'),
};

export const fulfillRevealInputSchema = {
    tokenIds: z
        .array(tokenIdSchema.transform(String))
        .nullable()
        .default(null)
        .describe('Cells whose open reveal requests to settle. Omit to settle every open reveal request you own.'),
    requestId: z
        .string()
        .nullable()
        .default(null)
        .describe(
            'Settle exactly this reveal request id, without asking the game API which requests are open — the ' +
                'way out when a request you know exists is not listed. Pass together with source.',
        ),
    source: z
        .string()
        .nullable()
        .default(null)
        .describe('Address of the randomness source the request named by requestId was opened at.'),
};
