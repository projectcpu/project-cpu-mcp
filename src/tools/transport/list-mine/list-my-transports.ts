import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeDeliveries } from '../format.utils.js';
import { listMyTransportsInputSchema } from '../types.js';
import { LIST_MY_TRANSPORTS_DESCRIPTION } from './constants.js';

export function registerListMyTransportsTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_list_my_transports',
        { description: LIST_MY_TRANSPORTS_DESCRIPTION, inputSchema: listMyTransportsInputSchema },
        async (args) => {
            const deliveries = await context.transport.listMine(args.filter);
            const { resources } = await context.appConfig.load();
            const header = `${deliveries.length} delivery(ies) · filter=${args.filter}`;

            return {
                content: [
                    { type: 'text', text: `${header}\n${summarizeDeliveries(deliveries, resources)}` },
                    { type: 'text', text: JSON.stringify(deliveries) },
                ],
            };
        },
    );
}
