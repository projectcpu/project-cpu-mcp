import { ROUTE_NETWORK_DESCRIPTION } from './constants.js';
import type { RouteNetworkResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { routeNetworkInputSchema } from '../types.js';

function summarizeNetwork(result: RouteNetworkResult): string {
    const hubs = result.nodes.filter((n) => n.isHub).length;
    const own = result.nodes.filter((n) => n.isOwn).length;
    const parts = [
        `Route network: ${result.nodes.length} waypoints (${own} yours, ${hubs} hubs), ` +
            `${result.edges.length} legal hops, ${result.components} connected component(s)`,
    ];
    if (result.from !== null && result.towards !== null) {
        const fromNode = result.nodes.find((n) => n.tokenId === result.from);
        const toNode = result.nodes.find((n) => n.tokenId === result.towards);
        const linked = fromNode !== undefined && toNode !== undefined && fromNode.component === toNode.component;
        parts.push(
            `${result.from} → ${result.towards} is ${result.fromToTarget ?? '?'} grid steps; ` +
                (linked
                    ? 'both sit in the same component — a chain exists, build it from the edges.'
                    : 'they are NOT connected through the current network — there is a gap to bridge.'),
        );
    }
    parts.push(result.note);
    return parts.join(' ');
}

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
                    { type: 'text', text: summarizeNetwork(result) },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
