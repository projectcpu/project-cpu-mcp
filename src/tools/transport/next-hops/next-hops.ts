import { NEXT_HOPS_DESCRIPTION } from './constants.js';
import type { NextHopsResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { nextHopsInputSchema } from '../types.js';

function originNote(result: NextHopsResult): string {
    if (result.fromReady !== false) {
        return '';
    }
    return (
        ` ${result.from} has a building still under construction, so your reach from here is normal cell reach — ` +
        'a Hub grants hub reach only once its construction finishes.'
    );
}

function summarizeHops(result: NextHopsResult): string {
    if (result.hops.length === 0) {
        return (
            `No eligible waypoints within reach of ${result.from} (reach ${result.fromRadius}) — the route ends ` +
            'here.' +
            `${originNote(result)} ` +
            'Build a Hub to bridge the gap, use closer cells, or reveal what you own nearby.'
        );
    }
    const towards =
        result.towards !== null ? ` towards ${result.towards} (${result.targetDistance ?? '?'} steps away)` : '';
    const lines = result.hops.map((hop) => {
        const kind = hop.isOwn ? 'own' : 'hub';
        const fee = hop.transitFeePerUnit !== null ? `, fee ${hop.transitFeePerUnit} $CPU/u` : '';
        const remaining = hop.distanceToTarget !== null ? `, ${hop.distanceToTarget} steps to target` : '';
        return `${hop.tokenId} (${kind}, reach ${hop.radius}, ${hop.hopDistance} step hop${fee}${remaining})`;
    });
    return (
        `${result.hops.length} legal next hop(s) from ${result.from} (reach ${result.fromRadius})${towards}: ` +
        `${lines.join('; ')}.` +
        `${originNote(result)} ${result.note}`
    );
}

export function registerNextHopsTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_next_hops',
        { description: NEXT_HOPS_DESCRIPTION, inputSchema: nextHopsInputSchema },
        async (args) => {
            const result = await context.route.nextHops({
                from: args.from,
                towards: args.towards,
                resourceId: args.resourceId,
            });

            return {
                content: [
                    { type: 'text', text: summarizeHops(result) },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
