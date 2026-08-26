import { GET_MY_LISTINGS_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import { summarizeListingPage } from '../format.utils.js';
import { marketPageInputSchema, type MarketToolDefinition } from '../types.js';

export function createGetMyListingsTool(context: AppContext): MarketToolDefinition {
    return {
        name: 'cpu_get_my_listings',
        description: GET_MY_LISTINGS_DESCRIPTION,
        inputSchema: marketPageInputSchema,
        handler: async (args) => {
            const { cursor } = args as { cursor: string | null };
            const page = await context.marketProfile.getMyListings(cursor ?? null);

            return {
                content: [
                    { type: 'text', text: summarizeListingPage(page) },
                    { type: 'text', text: JSON.stringify(page) },
                ],
            };
        },
    };
}
