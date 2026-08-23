import { BuildingKind } from '../api/types.js';
import { neighbors } from '../geometry/adjacency.js';
import { kRing } from '../geometry/graph.utils.js';

export interface RouteNode {
    tokenId: string;
    isOwn: boolean;
    isHub: boolean;
    radius: number;
}

export interface ReachableWaypoint {
    node: RouteNode;
    hopDistance: number;
}

/** The routing facts a catalog row contributes: which building it is, and how far it reaches once Ready. */
export interface RadiusCatalogEntry {
    type: string;
    kind: BuildingKind;
    radius: number;
}

/** What a cell must expose for its reach to be derived: a Ready hub-kind building, or anything else. */
export interface RadiusCell {
    activeHub: boolean;
    building: { type: string } | null;
}

export interface RadiusPolicy {
    moveRadius: number;
    defaultHubRadius: number;
    hubRadiusByBuildingType: ReadonlyMap<string, number>;
}

export function radiusPolicy(
    transport: { moveRadius: number; hubRadius: number },
    buildings: ReadonlyArray<RadiusCatalogEntry>,
): RadiusPolicy {
    const hubRadiusByBuildingType = new Map<string, number>();
    for (const building of buildings) {
        if (building.kind === BuildingKind.Hub) {
            hubRadiusByBuildingType.set(building.type, building.radius);
        }
    }
    return { moveRadius: transport.moveRadius, defaultHubRadius: transport.hubRadius, hubRadiusByBuildingType };
}

export function effectiveNodeRadius(cell: RadiusCell, policy: RadiusPolicy): number {
    if (!cell.activeHub) {
        return policy.moveRadius;
    }
    const type = cell.building === null ? null : cell.building.type;
    const served = type === null ? undefined : policy.hubRadiusByBuildingType.get(type);
    return served ?? policy.defaultHubRadius;
}

export function effectiveTransitFee(
    overrides: Record<number, string> | null,
    resourceId: number,
    floors: Record<number, string>,
): string {
    const override = overrides?.[resourceId];
    if (override !== undefined && override !== '0') {
        return override;
    }
    const floor = floors[resourceId];
    if (floor === undefined) {
        throw new Error(`Resource ${resourceId} has no transit-fee floor in the loaded config.`);
    }
    return floor;
}

export function waypointTransitFee(
    node: RouteNode,
    overrides: Record<number, string> | null,
    resourceId: number,
    floors: Record<number, string>,
): string | null {
    return !node.isOwn && node.isHub ? effectiveTransitFee(overrides, resourceId, floors) : null;
}

export function hopReachLimit(a: RouteNode, b: RouteNode): number {
    return Math.max(0, a.radius + b.radius - 1);
}

export function isHopLegal(a: RouteNode, b: RouteNode, distance: number): boolean {
    return distance <= hopReachLimit(a, b);
}

export function maxNodeRadius(nodes: Map<string, RouteNode>): number {
    let max = 0;
    for (const node of nodes.values()) {
        max = Math.max(max, node.radius);
    }
    return max;
}

export function reachableWaypoints(
    from: RouteNode,
    nodes: Map<string, RouteNode>,
    widestRadius: number,
): Array<ReachableWaypoint> {
    const scan = Math.max(0, from.radius + widestRadius - 1);
    const result: Array<ReachableWaypoint> = [];
    for (const [token, distance] of kRing(Number(from.tokenId), scan)) {
        if (distance === 0) {
            continue;
        }
        const node = nodes.get(String(token));
        if (node === undefined || !isHopLegal(from, node, distance)) {
            continue;
        }
        result.push({ node, hopDistance: distance });
    }
    return result;
}

export interface NetworkEdge {
    a: string;
    b: string;
    distance: number;
}

export function networkEdges(nodes: Map<string, RouteNode>): Array<NetworkEdge> {
    const widest = maxNodeRadius(nodes);
    const edges: Array<NetworkEdge> = [];
    for (const node of nodes.values()) {
        for (const { node: other, hopDistance } of reachableWaypoints(node, nodes, widest)) {
            if (Number(other.tokenId) > Number(node.tokenId)) {
                edges.push({ a: node.tokenId, b: other.tokenId, distance: hopDistance });
            }
        }
    }
    return edges.sort((x, y) => Number(x.a) - Number(y.a) || Number(x.b) - Number(y.b));
}

export function componentLabels(nodes: Map<string, RouteNode>, edges: Array<NetworkEdge>): Map<string, number> {
    const adjacency = new Map<string, Array<string>>();
    const link = (from: string, to: string): void => {
        const list = adjacency.get(from);
        if (list === undefined) {
            adjacency.set(from, [to]);
        } else {
            list.push(to);
        }
    };
    for (const edge of edges) {
        link(edge.a, edge.b);
        link(edge.b, edge.a);
    }
    const labels = new Map<string, number>();
    let component = 0;
    const tokens = [...nodes.keys()].sort((x, y) => Number(x) - Number(y));
    for (const token of tokens) {
        if (labels.has(token)) {
            continue;
        }
        let frontier = [token];
        labels.set(token, component);
        while (frontier.length > 0) {
            const next: Array<string> = [];
            for (const current of frontier) {
                for (const neighbor of adjacency.get(current) ?? []) {
                    if (!labels.has(neighbor)) {
                        labels.set(neighbor, component);
                        next.push(neighbor);
                    }
                }
            }
            frontier = next;
        }
        component += 1;
    }
    return labels;
}

export function distancesFrom(origin: number, targets: ReadonlySet<number>, maxSteps: number): Map<number, number> {
    const found = new Map<number, number>();
    if (targets.has(origin)) {
        found.set(origin, 0);
    }
    const seen = new Set<number>([origin]);
    let frontier = [origin];
    for (let depth = 1; depth <= maxSteps && found.size < targets.size; depth++) {
        const next: Array<number> = [];
        for (const node of frontier) {
            for (const neighbor of neighbors(node)) {
                if (seen.has(neighbor)) {
                    continue;
                }
                seen.add(neighbor);
                if (targets.has(neighbor)) {
                    found.set(neighbor, depth);
                }
                next.push(neighbor);
            }
        }
        if (next.length === 0) {
            break;
        }
        frontier = next;
    }
    return found;
}
