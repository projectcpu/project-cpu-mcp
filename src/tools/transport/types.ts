import { z } from 'zod';

import { tokenIdSchema } from '../../geometry/types.js';
import { ROUTE_AMOUNT_PATTERN } from '../../services/route.constants.js';
import { DeliveryFilter } from '../../services/types.js';

export const transportInputSchema = {
    path: z
        .array(tokenIdSchema)
        .min(2)
        .describe(
            'Waypoint chain of cell tokenIds [source, ...intermediate, target]. Source and target must be your ' +
                'own cells past their first completed reveal; every cell between them may be Virgin ground (no ' +
                'completed reveal, minted or not), a cell of yours, or any cell carrying a finished Hub, foreign ' +
                'ones included. Each hop must span at most radius(from)+radius(to)−1 grid steps, and radius is ' +
                'per cell: a plain cell reaches the move radius, a finished Hub the radius its own tier serves ' +
                '(cpu_get_game_config lists the radius of every Hub tier). Scout legal hops with cpu_next_hops ' +
                'and chain them yourself; the ' +
                'Transport contract validates.',
        ),
    resourceId: z.number().int().describe('Resource type id to move (must have a balance at the source cell).'),
    amount: z
        .string()
        .regex(/^[1-9]\d*$/)
        .describe('Units to move, as a positive integer string (matches on-map resource balances).'),
};

/**
 * The Lot return context, shared by both route actions. Naming a lot switches the plan to that lot's way
 * home; leaving it null keeps ordinary planning, exception and all.
 */
const lotReturnContextSchema = z
    .string()
    .regex(/^\d+$/)
    .nullable()
    .default(null)
    .describe(
        'Optional lot id — plan the way home for this lot instead of an ordinary shipment. For an Evicted ' +
            'lot the source is the hub it was listed on, admitted from the lot itself with the reach and the ' +
            'rate recorded there, so the plan survives that hub being demolished, rebuilt or sold. Nothing ' +
            'after the source changes: the destination is still your own revealed cell and every waypoint ' +
            'follows the ordinary rules. Verify the chain with cpu_quote_lot_return.',
    );

export const routeNetworkInputSchema = {
    from: tokenIdSchema.describe(
        'Source cell tokenId — where the cargo stands now. Must be your own cell past its first completed ' +
            'reveal; a foreign Hub is passage, never an end of a shipment.',
    ),
    towards: tokenIdSchema.describe(
        'Target cell tokenId — where the cargo must end up. Must be your own cell past its first completed ' +
            'reveal, and a different cell from `from`.',
    ),
    resourceId: z
        .number()
        .int()
        .describe('The cargo resource id — every foreign-Hub node carries its exact per-unit transit fee for it.'),
    amount: z
        .string()
        .regex(ROUTE_AMOUNT_PATTERN)
        .describe(
            'Units to move, as a positive integer string (matches on-map resource balances). Carried through ' +
                'the graph and into the prefilled quote call unchanged.',
        ),
    lotId: lotReturnContextSchema,
};

export const nextHopsInputSchema = {
    from: tokenIdSchema.describe(
        'The cell to hop from — where the cargo stands now: your own cell, a cell with a finished Hub, or ' +
            'Virgin ground (no completed reveal).',
    ),
    resourceId: z
        .number()
        .int()
        .describe('The cargo resource id — each candidate hub shows its exact per-unit transit fee for it.'),
    towards: tokenIdSchema
        .nullable()
        .default(null)
        .describe('Optional destination — adds the remaining grid distance to it for each candidate (a compass).'),
    lotId: lotReturnContextSchema,
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
