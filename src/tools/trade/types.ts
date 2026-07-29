import { z } from 'zod';

import { LotAvailability, LotSort, LotState, type MarketResourceSummary } from '../../api/types.js';
import { MAX_ROUTE_RADIUS } from '../../geometry/constants.js';
import { tokenIdSchema } from '../../geometry/types.js';

export interface EnrichedMarketSummary extends MarketResourceSummary {
    liveSaleFeePercent: number | null;
}

const positiveIntString = z
    .string()
    .regex(/^[1-9]\d*$/)
    .describe('A positive integer, as a string (matches on-map unit counts).');

export const createLotInputSchema = {
    chain: z
        .array(tokenIdSchema)
        .min(2)
        .describe(
            'Waypoint tokenIds [source, ...waypoints, hub] — first node is your source cell, last is the listing ' +
                'Hub. A route through a foreign Hub is paid in $CPU. Scout waypoints with cpu_next_hops.',
        ),
    resourceId: z.number().int().describe('Resource type id to list (must have a balance at the source cell).'),
    value: positiveIntString.describe('Units to list, as a positive integer string.'),
    pricePerUnit: z
        .string()
        .regex(/^\d+(\.\d+)?$/)
        .describe('Asking price per unit in $CPU (positive decimal string, e.g. "0.5"). Must be > 0.'),
    maxSaleFeePercent: z
        .number()
        .min(0)
        .max(100)
        .nullable()
        .default(null)
        .describe(
            'Optional seller tolerance: the highest sale-fee percent (0–100) you accept the hub charging on each ' +
                "sale. Omit to lock in the hub's live rate at listing time as the tolerance. The hub settles its " +
                'live rate on every sale (never more than the tolerance); if the owner later raises it above the ' +
                'tolerance the lot freezes — buys revert until the rate drops back to the tolerance or below — and ' +
                'cpu_cancel_lot is always fee-free.',
        ),
};

export const setSaleFeeInputSchema = {
    hubTokenId: tokenIdSchema.describe('The Hub cell token id whose sale-fee rate you are setting (you must own it).'),
    resourceId: z.number().int().describe('Resource type id the rate applies to (one resource per call).'),
    feePercent: z
        .number()
        .min(0)
        .max(100)
        .describe(
            'New sale-fee rate as a percent, 0–100 (0.01 granularity, i.e. whole basis points). 0 = listed free.',
        ),
};

export const buyLotInputSchema = {
    lotId: z.string().describe('The lot id to buy from (from list_lots / get_lot / get_markets).'),
    chain: z
        .array(tokenIdSchema)
        .min(2)
        .describe(
            'Waypoint tokenIds [hub, ...waypoints, destination] — first node is the lot Hub, last is your own ' +
                'revealed cell where the goods are delivered. Scout waypoints with cpu_next_hops.',
        ),
    value: positiveIntString.describe('Units to buy, as a positive integer string (≤ the lot remaining).'),
};

export const cancelLotInputSchema = {
    lotId: z.string().describe('The lot id to cancel (must be yours).'),
    chain: z
        .array(tokenIdSchema)
        .min(2)
        .describe(
            'Waypoint tokenIds [hub, ...waypoints, destination] for the return shipment — first node is the lot ' +
                'Hub, last is your own revealed cell where the unsold units return. A route through a foreign Hub ' +
                'is paid in $CPU.',
        ),
};

export const quoteBuyInputSchema = {
    lotId: z.string().describe('The lot id to preview a buy on.'),
    value: positiveIntString.describe('Units to buy, as a positive integer string.'),
    chain: z
        .array(tokenIdSchema)
        .min(2)
        .nullable()
        .default(null)
        .describe(
            'Waypoint tokenIds [hub, ...waypoints, destination] to include transit fees (the exact total buy_lot ' +
                'would charge); omit for a seller-only estimate (price × value).',
        ),
};

export const listLotsInputSchema = {
    hub: tokenIdSchema.nullable().default(null).describe('Filter to a Hub by its cell token id.'),
    resourceId: z.number().int().nullable().default(null).describe('Filter by resource id.'),
    seller: z.string().nullable().default(null).describe('Filter by seller address.'),
    minPrice: z.string().nullable().default(null).describe('Minimum price per unit ($CPU decimal string).'),
    maxPrice: z.string().nullable().default(null).describe('Maximum price per unit ($CPU decimal string).'),
    availability: z
        .nativeEnum(LotAvailability)
        .nullable()
        .default(null)
        .describe(
            'open (default, buyable now — frozen lots hidden) | incoming (paid & en route) | ' +
                'frozen (live rate exceeds the seller tolerance — not buyable until the hub lowers it) | all.',
        ),
    sort: z
        .nativeEnum(LotSort)
        .nullable()
        .default(null)
        .describe('price_asc | recent | nearest (nearest requires aroundTokenId).'),
    limit: z.number().int().nullable().default(null).describe('Page size (default 50, max 200).'),
    offset: z.number().int().nullable().default(null).describe('Page offset.'),
    aroundTokenId: tokenIdSchema.nullable().default(null).describe('Zone anchor as a cell token id.'),
    radius: z
        .number()
        .int()
        .min(0)
        .max(MAX_ROUTE_RADIUS)
        .nullable()
        .default(null)
        .describe(`Zone radius in grid steps around aroundTokenId (server clamps to ${MAX_ROUTE_RADIUS}).`),
};

export const marketsInputSchema = {
    hub: tokenIdSchema.nullable().default(null).describe('Filter to a Hub by its cell token id.'),
    resourceId: z.number().int().nullable().default(null).describe('Filter by resource id.'),
    aroundTokenId: tokenIdSchema.nullable().default(null).describe('Zone anchor as a cell token id.'),
    radius: z
        .number()
        .int()
        .min(0)
        .max(MAX_ROUTE_RADIUS)
        .nullable()
        .default(null)
        .describe(`Zone radius in grid steps around aroundTokenId (server clamps to ${MAX_ROUTE_RADIUS}).`),
};

export const getLotInputSchema = {
    lotId: z.string().describe('The lot id to inspect.'),
};

export const listMyLotsInputSchema = {
    state: z
        .nativeEnum(LotState)
        .nullable()
        .default(null)
        .describe('Optional lifecycle filter (delivering, open, sold, cancelled). Omit for all.'),
};
