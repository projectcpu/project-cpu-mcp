import { z } from 'zod';

import { tokenIdSchema } from '../../../geometry/types.js';

export const lotReturnInputSchema = {
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
