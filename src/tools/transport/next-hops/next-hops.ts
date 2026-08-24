import { NEXT_HOPS_DESCRIPTION, NEXT_HOPS_SUMMARY_LIMIT } from './constants.js';
import type { PlannedNextHopsResult } from '../../../services/route.types.js';
import type { NextHopView } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { nextHopsInputSchema } from '../types.js';

/** Says out loud why the origin is legal at all — nothing on today's map explains a hop from a razed hub. */
function returnNote(result: PlannedNextHopsResult): string {
    const source = result.lotReturn?.historicalSource ?? null;
    if (source === null) {
        return '';
    }
    return (
        ` This survey plans the way home for lot ${result.lotReturn?.lotId ?? ''}: ${result.from} is its listed ` +
        `hub, admitted from the lot itself with the reach recorded there (${source.radius}), whatever stands ` +
        'there now. Every candidate below is judged on today’s map as usual.'
    );
}

function originNote(result: PlannedNextHopsResult): string {
    if (result.fromReady !== false) {
        return '';
    }
    return (
        ` ${result.from} has a building still under construction, so your reach from here is normal cell reach — ` +
        'a Hub grants hub reach only once its construction finishes.'
    );
}

function hopKind(hop: NextHopView): string {
    if (hop.isHub) {
        return 'hub';
    }
    return hop.isVirgin ? 'virgin' : 'own';
}

function describeHop(hop: NextHopView): string {
    const fee = hop.transitFeePerUnit !== null ? `, fee ${hop.transitFeePerUnit} $CPU/u` : '';
    const remaining = hop.distanceToTarget !== null ? `, ${hop.distanceToTarget} steps to target` : '';
    return `${hop.tokenId} (${hopKind(hop)}, radius ${hop.radius}, ${hop.hopDistance} step hop${fee}${remaining})`;
}

function summarizeHops(result: PlannedNextHopsResult): string {
    if (result.hops.length === 0) {
        return (
            `No eligible waypoints within reach of ${result.from} (radius ${result.fromRadius}) — the route ends ` +
            'here.' +
            `${returnNote(result)}${originNote(result)} ` +
            'Build a Hub to bridge the gap, use closer cells, or reveal what you own nearby.'
        );
    }
    const towards =
        result.towards !== null ? ` towards ${result.towards} (${result.targetDistance ?? '?'} steps away)` : '';
    const shown = result.hops.slice(0, NEXT_HOPS_SUMMARY_LIMIT);
    const lines = shown.map(describeHop);
    const hidden = result.hops.length - shown.length;
    const rest = hidden > 0 ? ` + ${hidden} more in the JSON payload` : '';
    return (
        `${result.hops.length} legal next hop(s) from ${result.from} (radius ${result.fromRadius})${towards}: ` +
        `${lines.join('; ')}${rest}.` +
        `${returnNote(result)}${originNote(result)} ${result.note}`
    );
}

export function registerNextHopsTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_next_hops',
        { description: NEXT_HOPS_DESCRIPTION, inputSchema: nextHopsInputSchema },
        async (args) => {
            const result = await context.route.nextHops(
                {
                    from: args.from,
                    towards: args.towards,
                    resourceId: args.resourceId,
                },
                args.lotId === null ? null : { lotId: args.lotId },
            );

            return {
                content: [
                    { type: 'text', text: summarizeHops(result) },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
