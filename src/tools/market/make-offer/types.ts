import type { IMarketOfferService } from '../../../services/market/offer.types.js';
import { cellTokenIdSchema, positiveBaseUnitAmountSchema, unixSecondsSchema } from '../../../services/market/types.js';

export interface MakeCellOfferContext {
    marketOffer: IMarketOfferService;
}

export const makeCellOfferInputSchema = {
    tokenId: cellTokenIdSchema.describe(
        'The one exact Cell to bid on, as a decimal token id with no leading zeroes (e.g. "1234", never "01234"). ' +
            'Somebody else owns it.',
    ),
    amount: positiveBaseUnitAmountSchema.describe(
        'What you bid, as a positive decimal integer of the currency base units — never a decimal fraction. The ' +
            'currency is the one the marketplace configures for this collection and is reported back to you; you ' +
            'do not choose it here.',
    ),
    expirationTime: unixSecondsSchema.describe(
        'The Unix second at which the offer stops being acceptable. It must be in the future.',
    ),
};
