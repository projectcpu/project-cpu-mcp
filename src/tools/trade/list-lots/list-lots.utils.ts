import { BUYER_VISIBLE_LOT_STATES } from './constants.js';
import type { LotView } from '../../../api/types.js';

/**
 * Buyer discovery answers "what can I buy, now or once it lands" — so it carries Open and Delivering
 * and nothing else. Filtering here as well as server-side is deliberate: an Evicted lot reaching a
 * buyer's book reads as an offer, and an offer that cannot be filled is worse than a missing row.
 */
export function buyerVisibleLots(lots: Array<LotView>): Array<LotView> {
    return lots.filter((lot) => BUYER_VISIBLE_LOT_STATES.includes(lot.state));
}
