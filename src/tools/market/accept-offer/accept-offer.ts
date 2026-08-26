import { ACCEPT_CELL_OFFER_DESCRIPTION } from './constants.js';
import { summarizeSoldCell } from './format.utils.js';
import { acceptCellOfferInputSchema, type AcceptCellOfferContext } from './types.js';
import type { AcceptCellOfferRequest } from '../../../services/market/acceptance.types.js';
import type { MarketToolDefinition } from '../types.js';

export function createAcceptCellOfferTool(context: AcceptCellOfferContext): MarketToolDefinition {
    return {
        name: 'cpu_accept_cell_offer',
        description: ACCEPT_CELL_OFFER_DESCRIPTION,
        inputSchema: acceptCellOfferInputSchema,
        handler: async (args) => {
            const input = args as AcceptCellOfferRequest;
            const result = await context.marketAcceptance.acceptCellOffer({
                orderHash: input.orderHash,
                tokenId: input.tokenId,
            });

            return {
                content: [
                    { type: 'text', text: summarizeSoldCell(result) },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    };
}
