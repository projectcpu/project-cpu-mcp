import { type IMarketOfferService, wethOfferAmountSchema } from '../../../services/market/offer.types.js';
import { cellTokenIdSchema, unixSecondsSchema } from '../../../services/market/types.js';

export interface MakeCellOfferContext {
    marketOffer: IMarketOfferService;
}

export const makeCellOfferInputSchema = {
    tokenId: cellTokenIdSchema.describe(
        'The one exact Cell to bid on, as a decimal token id with no leading zeroes (e.g. "0" or "1234", never "01234"). ' +
            'Somebody else owns it.',
    ),
    amount: wethOfferAmountSchema.describe(
        'What you bid in WETH base units, as a positive decimal integer. WETH has 18 decimals, so ' +
            '10000000000000000 base units is 0.01 WETH. If necessary, the tool wraps only the missing ETH.',
    ),
    expirationTime: unixSecondsSchema.describe(
        'The Unix second at which the offer stops being acceptable. It must be in the future.',
    ),
};
