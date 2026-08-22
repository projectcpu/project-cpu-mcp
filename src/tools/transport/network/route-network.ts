import { ROUTE_NETWORK_DESCRIPTION } from './constants.js';
import { routeNetworkPanel } from './panel.utils.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { routeNetworkInputSchema } from '../types.js';

export function registerRouteNetworkTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_route_network',
        { description: ROUTE_NETWORK_DESCRIPTION, inputSchema: routeNetworkInputSchema },
        async (args) => {
            const result = await context.route.network({
                from: args.from,
                towards: args.towards,
                resourceId: args.resourceId,
            });

            return {
                content: [
                    { type: 'text', text: routeNetworkPanel(result) },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
