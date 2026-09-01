import { GET_MY_OFFERS_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import { summarizeOfferPage } from '../format.utils.js';
import { getMyOffersOutputSchema } from '../output.types.js';
import { marketPageInputSchema, type MarketToolDefinition } from '../types.js';

export function createGetMyOffersTool(context: AppContext): MarketToolDefinition {
    return {
        name: 'cpu_get_my_offers',
        description: GET_MY_OFFERS_DESCRIPTION,
        inputSchema: marketPageInputSchema,
        outputSchema: getMyOffersOutputSchema,
        handler: async (args) => {
            const { cursor } = args as { cursor: string | null };
            const page = await context.marketProfile.getMyOffers(cursor ?? null);

            return {
                content: [
                    { type: 'text', text: summarizeOfferPage('Offers you made', page) },
                    { type: 'text', text: JSON.stringify(page) },
                ],
                structuredContent: page,
            };
        },
    };
}
