import { BUY_CELL_DESCRIPTION } from './constants.js';
import { summarizeBoughtCell } from './format.utils.js';
import { buyCellInputSchema } from './types.js';
import type { BuyCellRequest } from '../../../services/market/purchase.types.js';
import type { AppContext } from '../../../types.js';
import type { MarketToolDefinition } from '../types.js';

export function createBuyCellTool(context: AppContext): MarketToolDefinition {
    return {
        name: 'cpu_buy_cell',
        description: BUY_CELL_DESCRIPTION,
        inputSchema: buyCellInputSchema,
        handler: async (args) => {
            const input = args as BuyCellRequest;
            const result = await context.marketPurchase.buyCell({
                tokenId: input.tokenId,
                expectedOrderHash: input.expectedOrderHash,
                maxAmount: input.maxAmount,
            });

            return {
                content: [
                    { type: 'text', text: summarizeBoughtCell(result) },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    };
}
