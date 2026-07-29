import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeDelivery } from '../format.utils.js';
import { getTransportStatusInputSchema } from '../types.js';
import { GET_TRANSPORT_STATUS_DESCRIPTION } from './constants.js';

export function registerGetTransportStatusTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_transport_status',
        { description: GET_TRANSPORT_STATUS_DESCRIPTION, inputSchema: getTransportStatusInputSchema },
        async (args) => {
            const delivery = await context.transport.getStatus(args.deliveryId);
            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: summarizeDelivery(delivery, resources) },
                    { type: 'text', text: JSON.stringify(delivery) },
                ],
            };
        },
    );
}
