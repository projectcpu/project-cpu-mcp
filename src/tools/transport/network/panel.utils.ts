import { ROUTE_NETWORK_LABELS, ROUTE_NETWORK_LINKED, ROUTE_NETWORK_SPLIT, ROUTE_NETWORK_TITLE } from './constants.js';
import type { RouteNetworkResult } from '../../../services/types.js';
import { renderPanel } from '../../../utils/panel.utils.js';

function countNodes(result: RouteNetworkResult, matches: (node: RouteNetworkResult['nodes'][number]) => boolean) {
    return result.nodes.filter((node) => matches(node)).length;
}

function link(result: RouteNetworkResult): string | null {
    if (result.from === null || result.towards === null) {
        return null;
    }
    const fromNode = result.nodes.find((node) => node.tokenId === result.from);
    const toNode = result.nodes.find((node) => node.tokenId === result.towards);
    const linked = fromNode !== undefined && toNode !== undefined && fromNode.component === toNode.component;
    return linked ? ROUTE_NETWORK_LINKED : ROUTE_NETWORK_SPLIT;
}

export function routeNetworkPanel(result: RouteNetworkResult): string {
    const labels = ROUTE_NETWORK_LABELS;
    const paid = countNodes(result, (node) => node.transitFeePerUnit !== null && Number(node.transitFeePerUnit) > 0);

    return renderPanel({
        title: ROUTE_NETWORK_TITLE,
        rows: [
            [
                { label: labels.waypoints, value: `${result.nodes.length}` },
                { label: labels.own, value: `${countNodes(result, (node) => node.isOwn)}` },
                { label: labels.hubs, value: `${countNodes(result, (node) => node.isHub)}` },
                { label: labels.hops, value: `${result.edges.length}` },
            ],
            [
                { label: labels.components, value: `${result.components}` },
                { label: labels.reach, value: `move ${result.reach.moveRadius}, hub ${result.reach.hubRadius}` },
                { label: labels.paid, value: `${paid} of ${result.nodes.length}` },
            ],
            [
                { label: labels.from, value: result.from },
                { label: labels.towards, value: result.towards },
                { label: labels.steps, value: result.fromToTarget === null ? null : `${result.fromToTarget}` },
            ],
            [{ label: labels.link, value: link(result) }],
            [{ label: labels.note, value: result.note }],
        ],
    });
}
