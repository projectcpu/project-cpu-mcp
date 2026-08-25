import { z } from 'zod';

import { MAX_TRANSIT_FEE_WEI_DESCRIPTION, MAX_TRANSIT_FEE_WEI_MESSAGE } from './constants.js';
import { tokenIdSchema } from '../../../geometry/types.js';
import { WEI_STRING_PATTERN } from '../../../utils/wei.constants.js';

export const lotReturnQuoteInputSchema = {
    lotId: z.string().describe('The lot to send home (must be yours; open or evicted).'),
    chain: z
        .array(tokenIdSchema)
        .min(2)
        .describe(
            'Waypoint tokenIds [hub, ...waypoints, destination] for the whole route home — the first node is ' +
                'the hub holding the lot, the last is your own revealed cell where the remainder lands. Scout ' +
                'waypoints with cpu_next_hops.',
        ),
};

export const lotReturnInputSchema = {
    ...lotReturnQuoteInputSchema,
    maxTransitFeeWei: z
        .string()
        .regex(WEI_STRING_PATTERN, MAX_TRANSIT_FEE_WEI_MESSAGE)
        .describe(MAX_TRANSIT_FEE_WEI_DESCRIPTION),
};
