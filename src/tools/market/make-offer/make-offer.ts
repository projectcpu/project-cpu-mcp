import { MAKE_CELL_OFFER_DESCRIPTION } from './constants.js';
import { summarizeCellOffer } from './format.utils.js';
import { makeCellOfferInputSchema, type MakeCellOfferContext } from './types.js';
import type { MakeCellOfferRequest } from '../../../services/market/offer.types.js';
import { ToolEventType } from '../../types.js';
import type { MarketToolDefinition } from '../types.js';

export function createMakeCellOfferTool(context: MakeCellOfferContext): MarketToolDefinition {
    return {
        name: 'cpu_make_cell_offer',
        description: MAKE_CELL_OFFER_DESCRIPTION,
        inputSchema: makeCellOfferInputSchema,
        handler: async (args) => {
            const input = args as MakeCellOfferRequest;
            const result = await context.marketOffer.makeCellOffer({
                tokenId: input.tokenId,
                amount: input.amount,
                expirationTime: input.expirationTime,
            });

            return {
                content: [
                    { type: 'text', text: summarizeCellOffer(result) },
                    { type: 'text', text: JSON.stringify({ ...result, eventType: ToolEventType.CellOfferMade }) },
                ],
            };
        },
    };
}
