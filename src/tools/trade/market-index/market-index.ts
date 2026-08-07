import { GET_MARKET_INDEX_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeMarketIndex } from '../format.utils.js';

export function registerGetMarketIndexTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_market_index',
        { description: GET_MARKET_INDEX_DESCRIPTION, inputSchema: {} },
        async () => {
            const index = await context.trade.getMarketIndex();
            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: summarizeMarketIndex(index, resources) },
                    { type: 'text', text: JSON.stringify(index) },
                ],
            };
        },
    );
}
