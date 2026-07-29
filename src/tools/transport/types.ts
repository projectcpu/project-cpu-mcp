import { z } from 'zod';

import { tokenIdSchema } from '../../geometry/types.js';
import { DeliveryFilter } from '../../services/types.js';

export const transportInputSchema = {
    path: z
        .array(tokenIdSchema)
        .min(2)
        .describe(
            'Waypoint chain of cell tokenIds [source, ...intermediate, target]. Every waypoint must be revealed ' +
                'and eligible (your own cell, or a Hub); each hop must span at most radius(from)+radius(to)−1 grid ' +
                'steps (a plain cell reaches moveRadius, a Hub hubRadius — see get_game_config transport). ' +
                'Scout legal hops with cpu_next_hops and chain them yourself; the Transport contract validates.',
        ),
    resourceId: z.number().int().describe('Resource type id to move (must have a balance at the source cell).'),
    amount: z
        .string()
        .regex(/^[1-9]\d*$/)
        .describe('Units to move, as a positive integer string (matches on-map resource balances).'),
};

export const routeNetworkInputSchema = {
    resourceId: z
        .number()
        .int()
        .describe('The cargo resource id — every foreign-hub waypoint shows its exact per-unit transit fee for it.'),
    from: tokenIdSchema
        .nullable()
        .default(null)
        .describe('Optional source cell — annotates every waypoint with its grid distance from here.'),
    towards: tokenIdSchema
        .nullable()
        .default(null)
        .describe('Optional destination cell — annotates every waypoint with its remaining grid distance.'),
};

export const nextHopsInputSchema = {
    from: tokenIdSchema.describe('The cell to hop from (your revealed cell, or a Hub).'),
    resourceId: z
        .number()
        .int()
        .describe('The cargo resource id — each candidate hub shows its exact per-unit transit fee for it.'),
    towards: tokenIdSchema
        .nullable()
        .default(null)
        .describe('Optional destination — adds the remaining grid distance to it for each candidate (a compass).'),
};

export const getTransportStatusInputSchema = {
    deliveryId: z.string().describe('The on-chain delivery id (from `transport` or `list_my_transports`).'),
};

export const listMyTransportsInputSchema = {
    filter: z
        .nativeEnum(DeliveryFilter)
        .default(DeliveryFilter.All)
        .describe('Filter your deliveries: all, in_transit, delivered, ready_to_finalize.'),
};

export const finalizeDeliveryInputSchema = {
    ids: z
        .array(z.string())
        .min(1)
        .describe('On-chain delivery ids to finalize (arrived deliveries, from `list_my_transports`).'),
};
