import { ROUTE_NETWORK_LABELS, ROUTE_NETWORK_LINKED, ROUTE_NETWORK_SPLIT, ROUTE_NETWORK_TITLE } from './constants.js';
import type { PlannedRouteNetworkResult } from '../../../services/route.types.js';
import type { PanelRow } from '../../../utils/panel.types.js';
import { renderPanel } from '../../../utils/panel.utils.js';

function lotReturnRows(result: PlannedRouteNetworkResult): Array<PanelRow> {
    const plan = result.request.lotReturn;
    if (plan === null) {
        return [];
    }
    const source = plan.historicalSource;
    return [
        [
            { label: ROUTE_NETWORK_LABELS.lot, value: `${plan.lotId} (${plan.lotState})` },
            {
                label: ROUTE_NETWORK_LABELS.source,
                value:
                    source === null
                        ? 'judged on today’s map, exactly like an ordinary plan'
                        : `the listed hub of the lot, admitted at reach ${source.radius} and ` +
                          `${source.transitFeePerUnit} $CPU per unit whatever stands there now`,
            },
        ],
    ];
}

export function routeNetworkPanel(result: PlannedRouteNetworkResult): string {
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
            ...lotReturnRows(result),
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
