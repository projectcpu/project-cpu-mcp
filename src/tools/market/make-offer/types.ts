import { type IMarketOfferService, usdgOfferAmountSchema } from '../../../services/market/offer.types.js';
import { cellTokenIdSchema, unixSecondsSchema } from '../../../services/market/types.js';

export interface MakeCellOfferContext {
    marketOffer: IMarketOfferService;
}

export const makeCellOfferInputSchema = {
    tokenId: cellTokenIdSchema.describe(
        'The one exact Cell to bid on, as a decimal token id with no leading zeroes (e.g. "0" or "1234", never "01234"). ' +
            'Somebody else owns it.',
    ),
    amount: usdgOfferAmountSchema.describe(
        'What you bid in USDG base units, as a positive decimal integer in whole-cent increments. USDG has 6 ' +
            'decimals, so 10000 base units is $0.01 and values such as 15000 are rejected.',
    ),
    expirationTime: unixSecondsSchema.describe(
        'The Unix second at which the offer stops being acceptable. It must be in the future.',
    ),
};
