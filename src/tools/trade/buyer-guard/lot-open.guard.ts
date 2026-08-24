import { LOT_STATE_ADVICE, NO_SIDE_EFFECTS_NOTE } from './constants.js';
import type { LotStateReader } from './types.js';
import { type LotView, LotState } from '../../../api/types.js';

/**
 * Re-reads the lot every time instead of trusting whatever the caller last saw: the whole point is to
 * refuse on the state observed now, before the buy path can approve $CPU or send anything. A lot that
 * turns unbuyable between this read and the transaction is the contract's race to lose, not ours.
 */
export async function requireOpenLot(reader: LotStateReader, lotId: string): Promise<LotView> {
    const lot = await reader.getLot(lotId);
    if (lot.state === LotState.Open) {
        return lot;
    }
    throw new Error(
        `Lot ${lotId} is not open — it is ${lot.state}. ${LOT_STATE_ADVICE[lot.state]} ${NO_SIDE_EFFECTS_NOTE}`,
    );
}
