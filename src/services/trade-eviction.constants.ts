export const LOT_RETURN_TOOL = 'cpu_return_lot';

export const EVICTION_TX_LABEL = 'Evict lot';

/**
 * An evicted lot keeps its per-seller slot until the seller ships it home, so eviction never reads as
 * "the lot is gone" anywhere the agent can see it.
 */
export const EVICTION_SLOT_NOTE =
    'An evicted lot still holds one of that seller’s lot slots on the hub and keeps them from listing any ' +
    'resource there until they schedule its return.';

export const EVICTION_REVERT_REASONS: ReadonlyArray<{ name: string; reason: string }> = [
    {
        name: 'NotHubOwner',
        reason:
            'the Trade contract does not see you as the hub owner — the hub changed hands between the check and ' +
            'the transaction, or the local map is ahead of the chain',
    },
    {
        name: 'SelfEviction',
        reason: `a seller cannot evict their own lot; send the remainder home with a lot return (${LOT_RETURN_TOOL})`,
    },
    {
        name: 'LotNotOpen',
        reason:
            'the lot is no longer open — it sold out, was returned home, or someone else evicted it first; ' +
            're-read it with cpu_get_lot',
    },
];
