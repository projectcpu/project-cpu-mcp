import {
    cellTokenIdSchema,
    evmAddressSchema,
    positiveBaseUnitAmountSchema,
    unixSecondsSchema,
} from '../../../services/market/types.js';

export const listCellInputSchema = {
    tokenId: cellTokenIdSchema.describe(
        'The Cell to sell, as a decimal token id with no leading zeroes (e.g. "1234", never "01234"). ' +
            'You must own it.',
    ),
    price: positiveBaseUnitAmountSchema.describe(
        'The gross amount a buyer pays, as a positive decimal integer of the currency base units — never a ' +
            'decimal fraction. Marketplace and creator fees are taken out of this amount; the call returns the ' +
            'split and your estimated proceeds.',
    ),
    expirationTime: unixSecondsSchema.describe(
        'The Unix second at which the listing stops being fillable. It must be in the future.',
    ),
    buyerAddress: evmAddressSchema
        .nullable()
        .default(null)
        .describe(
            'Reserve the listing for exactly one buyer by passing their address; pass null (or omit it) to let ' +
                'anyone buy it. This never changes which wallet sells — that is always the authenticated wallet.',
        ),
};
