import type { IMarketAcceptanceService } from '../../../services/market/acceptance.types.js';
import { cellTokenIdSchema, orderHashSchema } from '../../../services/market/types.js';

export interface AcceptCellOfferContext {
    marketAcceptance: IMarketAcceptanceService;
}

export const acceptCellOfferInputSchema = {
    orderHash: orderHashSchema.describe(
        'The exact 32-byte 0x-prefixed `orderHash` of the offer you decided to accept, copied from ' +
            '`cpu_get_my_offers_received` or `cpu_get_cell_market`. This tool accepts that offer or nothing: it ' +
            'never falls back to a higher, newer or otherwise different offer.',
    ),
    tokenId: cellTokenIdSchema
        .nullable()
        .default(null)
        .describe(
            'The one Cell of yours to sell, as a decimal token id with no leading zeroes (e.g. "0" or "1234", never ' +
                '"01234"). REQUIRED for a trait or collection offer, because such an offer names a set of Cells ' +
                'and never picks one for you. For an item offer you may omit it (or pass null) and the Cell the ' +
                'offer bids for is used; if you do pass it, it must be that same Cell.',
        ),
};
