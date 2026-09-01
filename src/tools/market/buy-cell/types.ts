import { cellTokenIdSchema, orderHashSchema, positiveBaseUnitAmountSchema } from '../../../services/market/types.js';

export const buyCellInputSchema = {
    tokenId: cellTokenIdSchema.describe(
        'The Cell the listing sells, as a decimal token id with no leading zeroes (e.g. "0" or "1234", never "01234").',
    ),
    expectedOrderHash: orderHashSchema.describe(
        'The exact 32-byte 0x-prefixed `orderHash` of the listing you decided to buy, copied from ' +
            '`cpu_get_cell_market`. This tool buys that order or nothing: it never falls back to a cheaper, ' +
            'newer or otherwise different listing.',
    ),
    maxAmount: positiveBaseUnitAmountSchema.describe(
        'The most you are willing to pay, as a positive decimal integer of the currency base units — never a ' +
            'decimal fraction. If the pinned order costs more than this, the call fails without sending anything.',
    ),
};
