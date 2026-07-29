import { z } from 'zod';

import { SyndicateSort } from '../../api/types.js';

export const listSyndicatesInputSchema = {
    name: z.string().nullable().default(null).describe('Filter by name (substring match).'),
    minMembers: z
        .number()
        .int()
        .min(0)
        .nullable()
        .default(null)
        .describe('Only syndicates with at least this many members.'),
    maxMembers: z
        .number()
        .int()
        .min(0)
        .nullable()
        .default(null)
        .describe('Only syndicates with at most this many members.'),
    sort: z
        .nativeEnum(SyndicateSort)
        .nullable()
        .default(null)
        .describe('members_desc (largest first) | recent (newest first) | name (A→Z).'),
    limit: z.number().int().min(1).nullable().default(null).describe('Page size.'),
    offset: z.number().int().min(0).nullable().default(null).describe('Page offset.'),
};

export const getSyndicateInputSchema = {
    id: z.string().describe('The syndicate id (from cpu_list_syndicates).'),
    membersLimit: z.number().int().min(1).nullable().default(null).describe('Members page size.'),
    membersOffset: z.number().int().min(0).nullable().default(null).describe('Members page offset.'),
};

export const getSyndicateMembershipInputSchema = {
    address: z
        .string()
        .nullable()
        .default(null)
        .describe('Wallet address to look up; omit to check your own membership.'),
};

export const joinSyndicateInputSchema = {
    id: z.string().describe('The syndicate id to join (from cpu_list_syndicates).'),
};

export const leaveSyndicateInputSchema = {};

const syndicateRatesInputSchema = z
    .object({
        tradeDiscountPercent: z
            .number()
            .min(0)
            .max(100)
            .describe('Trade fee discount for same-syndicate buyers, as a percent (0–100, whole basis-point steps).'),
        transportDiscountPercent: z
            .number()
            .min(0)
            .max(100)
            .describe('Transit fee discount for same-syndicate payers, as a percent (0–100, whole basis-point steps).'),
        tradeTaxPercent: z
            .number()
            .min(0)
            .max(100)
            .describe(
                'Trade tax on members’ sales, paid to the manager, as a percent (0–100, whole basis-point steps).',
            ),
        transportTaxPercent: z
            .number()
            .min(0)
            .max(100)
            .describe(
                'Transit tax on members’ shipments, paid to the manager, as a percent (0–100, whole basis-point steps).',
            ),
    })
    .describe('The four syndicate rates as percentages; converted to basis points on-chain.');

export const createSyndicateInputSchema = {
    name: z.string().min(1).describe('Display name (1–64 bytes).'),
    link: z.string().default('').describe('Optional link (max 200 bytes); omit for none.'),
    manager: z
        .string()
        .nullable()
        .default(null)
        .describe('Manager wallet that receives the tax stream; omit to make yourself the manager.'),
    rates: syndicateRatesInputSchema,
};

export const setSyndicateParamsInputSchema = {
    id: z.string().describe('The syndicate id you manage (from cpu_get_syndicate).'),
    name: z.string().min(1).describe('Display name (1–64 bytes).'),
    link: z.string().default('').describe('Link (max 200 bytes); pass an empty string to clear it.'),
    rates: syndicateRatesInputSchema,
};

export const transferSyndicateManagerInputSchema = {
    id: z.string().describe('The syndicate id you manage.'),
    next: z.string().describe('The successor wallet address that becomes the new manager and tax recipient.'),
};
