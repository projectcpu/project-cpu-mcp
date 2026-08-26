import { LIST_CELL_DESCRIPTION } from './constants.js';
import { listCellInputSchema } from './types.js';
import type { ListCellRequest } from '../../../services/market/listing.types.js';
import type { AppContext } from '../../../types.js';
import { ToolEventType } from '../../types.js';
import { summarizeListedCell } from '../format.utils.js';
import type { MarketToolDefinition } from '../types.js';

export function createListCellTool(context: AppContext): MarketToolDefinition {
    return {
        name: 'cpu_list_cell',
        description: LIST_CELL_DESCRIPTION,
        inputSchema: listCellInputSchema,
        handler: async (args) => {
            const input = args as ListCellRequest;
            const result = await context.marketListing.listCell({
                tokenId: input.tokenId,
                price: input.price,
                expirationTime: input.expirationTime,
                buyerAddress: input.buyerAddress ?? null,
            });

            return {
                content: [
                    { type: 'text', text: summarizeListedCell(result) },
                    { type: 'text', text: JSON.stringify({ ...result, eventType: ToolEventType.CellListed }) },
                ],
            };
        },
    };
}
