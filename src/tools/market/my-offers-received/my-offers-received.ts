import { GET_MY_OFFERS_RECEIVED_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import { summarizeOfferPage } from '../format.utils.js';
import { marketPageInputSchema, type MarketToolDefinition } from '../types.js';

export function createGetMyOffersReceivedTool(context: AppContext): MarketToolDefinition {
    return {
        name: 'cpu_get_my_offers_received',
        description: GET_MY_OFFERS_RECEIVED_DESCRIPTION,
        inputSchema: marketPageInputSchema,
        handler: async (args) => {
            const { cursor } = args as { cursor: string | null };
            const page = await context.marketProfile.getMyOffersReceived(cursor ?? null);

            return {
                content: [
                    { type: 'text', text: summarizeOfferPage('Offers on your Cells', page) },
                    { type: 'text', text: JSON.stringify(page) },
                ],
            };
        },
    };
}
