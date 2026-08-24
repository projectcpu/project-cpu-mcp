import { EVICTION_REVERT_REASONS, EVICTION_SLOT_NOTE, LOT_RETURN_TOOL } from './trade-eviction.constants.js';

export function lotNotLiveMessage(lotId: string): string {
    return (
        `The Trade contract holds no live lot ${lotId}: it sold out, was cancelled, or its remainder has already ` +
        `gone home. There is nothing to evict.`
    );
}

export function lotDeliveringMessage(lotId: string, hubTokenId: string): string {
    return (
        `Lot ${lotId} is still delivering into Hub ${hubTokenId} — its escrow has not arrived yet. Only an open lot ` +
        `can be evicted, and eviction never finalizes a delivery on the seller's behalf. Wait for the escrow to ` +
        `land (the seller finalizes it), re-read the lot with cpu_get_lot, and evict once it is open.`
    );
}

export function lotAlreadyEvictedMessage(lotId: string, hubTokenId: string): string {
    return (
        `Lot ${lotId} on Hub ${hubTokenId} is already evicted, so evicting it again would change nothing. ` +
        `${EVICTION_SLOT_NOTE} Only the seller can move those units, with a lot return (${LOT_RETURN_TOOL}).`
    );
}

export function selfEvictionMessage(lotId: string): string {
    return (
        `Lot ${lotId} is your own lot, and eviction only ever ends someone else's. To take your own remainder off ` +
        `the shelf and ship it home, use a lot return (${LOT_RETURN_TOOL}) with the route you want it to travel.`
    );
}

export function hubNotInMapMessage(lotId: string, hubTokenId: string): string {
    return (
        `Hub ${hubTokenId}, which carries lot ${lotId}, is not in the current map, so your ownership of it cannot ` +
        `be verified. Only the hub owner may evict a lot from it.`
    );
}

export function notHubOwnerMessage(lotId: string, hubTokenId: string, owner: string): string {
    return (
        `Only the hub owner can evict a lot from Hub ${hubTokenId} (owner ${owner}), and lot ${lotId} sits there. ` +
        `Eviction is a hub owner's control over their own storage, never a way to reach another player's goods.`
    );
}

/** Names the on-chain refusal in the agent's own vocabulary; an undecoded revert travels unchanged. */
export function enrichEvictionRevert(error: unknown, lotId: string): unknown {
    if (!(error instanceof Error)) {
        return error;
    }
    const match = EVICTION_REVERT_REASONS.find((entry) => error.message.includes(entry.name));
    if (match === undefined) {
        return error;
    }
    return new Error(`${error.message} — lot ${lotId} was not evicted: ${match.reason}.`, { cause: error });
}
