import { GET_CELL_MARKET_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import { summarizeCellMarket } from '../format.utils.js';
import { getCellMarketOutputSchema } from '../output.types.js';
import { getCellMarketInputSchema, type MarketToolDefinition } from '../types.js';

export function createGetCellMarketTool(context: AppContext): MarketToolDefinition {
    return {
        name: 'cpu_get_cell_market',
        description: GET_CELL_MARKET_DESCRIPTION,
        inputSchema: getCellMarketInputSchema,
        outputSchema: getCellMarketOutputSchema,
        handler: async (args) => {
            const { tokenId } = args as { tokenId: string };
            const snapshot = await context.market.getCellMarket(tokenId);

            return {
                content: [
                    { type: 'text', text: summarizeCellMarket(snapshot) },
                    { type: 'text', text: JSON.stringify(snapshot) },
                ],
                structuredContent: snapshot,
            };
        },
    };
}
