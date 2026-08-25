import { LIST_LOTS_DESCRIPTION } from './constants.js';
import { buyerVisibleLots } from './list-lots.utils.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeLots } from '../format.utils.js';
import { listLotsInputSchema } from '../types.js';

export function registerListLotsTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_list_lots',
        { description: LIST_LOTS_DESCRIPTION, inputSchema: listLotsInputSchema },
        async (args) => {
            const lots = buyerVisibleLots(await context.trade.listLots(args));
            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: `${lots.length} lot(s)\n${summarizeLots(lots, resources)}` },
                    { type: 'text', text: JSON.stringify(lots) },
                ],
            };
        },
    );
}
