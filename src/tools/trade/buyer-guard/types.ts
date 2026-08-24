import type { LotView } from '../../../api/types.js';

/** The narrow read a buyer guard needs: one authoritative look at the lot it is about to spend on. */
export interface LotStateReader {
    getLot(lotId: string): Promise<LotView>;
}
