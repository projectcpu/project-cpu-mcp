import { EVICTED_COUNT_UNREADABLE, EVICTED_LISTING_BLOCK, EVICTED_LOT_NOT_SELLING } from './constants.js';
import type { EvictedHubCount } from './types.js';
import { LotState, type LotView } from '../../../api/types.js';
import { attentionItem } from '../../../map/attention.utils.js';
import { type AttentionItem, AttentionReason } from '../../../map/types.js';

const LIVE_STATES: ReadonlyArray<LotState> = [LotState.Delivering, LotState.Open, LotState.Evicted];

function plural(count: number, one: string, many: string): string {
    return count === 1 ? one : many;
}

function outstanding(count: number | null): string {
    return count === null
        ? EVICTED_COUNT_UNREADABLE
        : `The hub reports ${count} evicted ${plural(count, 'lot', 'lots')} of yours outstanding. ` +
              EVICTED_LISTING_BLOCK;
}

/**
 * Hubs worth asking the chain about. Every hub the seller still has a live lot on qualifies, not only the
 * ones with a visible evicted row: a hub whose evicted rows have not been projected yet is exactly the
 * case the count has to catch.
 */
export function liveHubTokenIds(lots: ReadonlyArray<LotView>): Array<string> {
    return [...new Set(lots.filter((lot) => LIVE_STATES.includes(lot.state)).map((lot) => lot.hubTokenId))];
}

function lotItem(lot: LotView, count: number | null): AttentionItem {
    return attentionItem({ tokenId: lot.hubTokenId }, AttentionReason.LotEvicted, {
        resourceId: lot.resourceId,
        lotId: lot.id,
        message:
            `Evicted: lot ${lot.id} was thrown out of hub ${lot.hubTokenId} with ${lot.remaining} of its ` +
            `resource still yours. ${EVICTED_LOT_NOT_SELLING} ${outstanding(count)} Each evicted lot is ` +
            `returned on its own — returning this one does not clear the others.`,
    });
}

function hubItem(hubTokenId: string, count: number, visible: number): AttentionItem {
    return attentionItem({ tokenId: hubTokenId }, AttentionReason.LotEvicted, {
        message:
            `Evicted backlog: hub ${hubTokenId} reports ${count} evicted ${plural(count, 'lot', 'lots')} of ` +
            `yours outstanding, but only ${visible} of them ${plural(visible, 'is', 'are')} listed here — the ` +
            `lot list is still catching up with the chain, so this hub is not clear. ${EVICTED_LISTING_BLOCK}`,
    });
}

/**
 * Reconciles the seller's evicted rows against the authoritative per-hub count. A zero count is the one
 * thing that may drop a row; a count above what is listed keeps the hub blocked with an item of its own,
 * so a lagging list never reads as a clear hub.
 */
export function evictedAttentionItems(
    lots: ReadonlyArray<LotView>,
    counts: ReadonlyArray<EvictedHubCount>,
): Array<AttentionItem> {
    const countByHub = new Map(counts.map((entry) => [entry.hubTokenId, entry.count]));
    const rowsByHub = new Map<string, Array<LotView>>();
    for (const lot of lots) {
        if (lot.state !== LotState.Evicted) {
            continue;
        }
        const rows = rowsByHub.get(lot.hubTokenId) ?? [];
        rows.push(lot);
        rowsByHub.set(lot.hubTokenId, rows);
    }

    const hubTokenIds = [...new Set([...rowsByHub.keys(), ...countByHub.keys()])].sort((a, b) => a.localeCompare(b));
    const items: Array<AttentionItem> = [];
    for (const hubTokenId of hubTokenIds) {
        const count = countByHub.get(hubTokenId) ?? null;
        if (count === 0) {
            continue;
        }
        const rows = rowsByHub.get(hubTokenId) ?? [];
        for (const lot of rows) {
            items.push(lotItem(lot, count));
        }
        if (count !== null && count > rows.length) {
            items.push(hubItem(hubTokenId, count, rows.length));
        }
    }
    return items;
}
