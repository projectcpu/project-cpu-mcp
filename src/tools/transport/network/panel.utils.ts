import { ROUTE_NETWORK_LABELS, ROUTE_NETWORK_LINKED, ROUTE_NETWORK_SPLIT, ROUTE_NETWORK_TITLE } from './constants.js';
import type { RouteNetworkResult } from '../../../services/types.js';
import { renderPanel } from '../../../utils/panel.utils.js';

export function routeNetworkPanel(result: RouteNetworkResult): string {
    const labels = ROUTE_NETWORK_LABELS;
    const request = result.request;

    return renderPanel({
        title: ROUTE_NETWORK_TITLE,
        rows: [
            [{ label: labels.graph, value: result.artifactPath }],
            [
                { label: labels.schema, value: `${result.schemaVersion}` },
                { label: labels.snapshot, value: `${result.snapshotVersion}` },
                { label: labels.waypoints, value: `${result.nodeCount}` },
                { label: labels.hops, value: `${result.edgeCount}` },
            ],
            [
                { label: labels.from, value: request.from },
                { label: labels.towards, value: request.towards },
                { label: labels.cargo, value: `${request.amount} of resource ${request.resourceId}` },
            ],
            [{ label: labels.link, value: result.connected ? ROUTE_NETWORK_LINKED : ROUTE_NETWORK_SPLIT }],
            [
                {
                    label: labels.next,
                    value: `load the file with code, follow every instruction below, then ${result.quoteTemplate.tool}`,
                },
            ],
            [{ label: labels.note, value: result.note }],
        ],
    });
}
