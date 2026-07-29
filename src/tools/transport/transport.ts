import { TRANSPORT_DESCRIPTION } from './constants.js';
import { summarizeTransport } from './format.utils.js';
import { transportInputSchema } from './types.js';
import type { AppContext } from '../../types.js';
import type { ToolRegistrar } from '../types.js';

export function registerTransportTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_transport',
        { description: TRANSPORT_DESCRIPTION, inputSchema: transportInputSchema },
        async (args) => {
            const result = await context.transport.transport({
                path: args.path,
                resourceId: args.resourceId,
                amount: args.amount,
            });

            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: summarizeTransport(result, resources) },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
