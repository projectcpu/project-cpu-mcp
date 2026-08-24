import { EVICT_LOT_NO_GOODS_NOTE, EVICT_LOT_SELLER_BLOCK_NOTE } from './constants.js';
import type { EvictLotResult } from '../../../services/types.js';
import { resourceLabel, type ResourceNames } from '../../../utils/format.utils.js';

/** Human header for a confirmed `evict_lot`. */
export function summarizeEvictLot(result: EvictLotResult, resources: ResourceNames): string {
    return (
        `Evicted lot ${result.lotId} from Hub ${result.hubTokenId}: ${result.remaining} ` +
        `${resourceLabel(resources, result.resourceId)} listed by ${result.sellerAddress} are off your shelf and ` +
        `no longer for sale (state ${result.state}). ${EVICT_LOT_NO_GOODS_NOTE} ${EVICT_LOT_SELLER_BLOCK_NOTE} ` +
        `evict tx ${result.txHash} in block ${result.blockNumber}.`
    );
}
