import { LIST_FILLS_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeFills } from '../format.utils.js';
import { listFillsInputSchema } from '../types.js';

export function registerListFillsTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_list_fills',
        { description: LIST_FILLS_DESCRIPTION, inputSchema: listFillsInputSchema },
        async (args) => {
            const fills = await context.trade.listFills(args);
            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: `${fills.length} fill(s)\n${summarizeFills(fills, resources)}` },
                    { type: 'text', text: JSON.stringify(fills) },
                ],
            };
        },
    );
}
