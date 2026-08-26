import type { IMarketCancelService } from '../../../services/market/cancel.types.js';
import { orderHashSchema } from '../../../services/market/types.js';

export interface CancelOrderContext {
    marketCancel: IMarketCancelService;
}

export const cancelOrderInputSchema = {
    orderHash: orderHashSchema.describe(
        'The exact 32-byte 0x-prefixed `orderHash` of YOUR OWN Market order, copied from `cpu_get_my_listings` or ' +
            '`cpu_get_my_offers`. The same input cancels a listing and an offer alike — the side is a fact of the ' +
            'order, not something you choose here.',
    ),
};
