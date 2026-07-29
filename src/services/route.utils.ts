import { neighbors } from '../geometry/adjacency.js';
import { kRing } from '../geometry/graph.utils.js';

export interface RouteNode {
    tokenId: string;
    isOwn: boolean;
    isHub: boolean;
}

export interface ReachableWaypoint {
    node: RouteNode;
    hopDistance: number;
}

export function nodeRadius(node: RouteNode, moveRadius: number, hubRadius: number): number {
    return node.isHub ? hubRadius : moveRadius;
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

export function pairReach(a: RouteNode, b: RouteNode, moveRadius: number, hubRadius: number): number {
    return nodeRadius(a, moveRadius, hubRadius) + nodeRadius(b, moveRadius, hubRadius) - 1;
}

export function reachableWaypoints(
    from: RouteNode,
    nodes: Map<string, RouteNode>,
    moveRadius: number,
    hubRadius: number,
): Array<ReachableWaypoint> {
    const fromRadius = nodeRadius(from, moveRadius, hubRadius);
    const result: Array<ReachableWaypoint> = [];
    for (const [token, distance] of kRing(Number(from.tokenId), fromRadius + hubRadius - 1)) {
        if (distance === 0) {
            continue;
        }
        const node = nodes.get(String(token));
        if (node === undefined || distance > pairReach(from, node, moveRadius, hubRadius)) {
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

export function networkEdges(nodes: Map<string, RouteNode>, moveRadius: number, hubRadius: number): Array<NetworkEdge> {
    const edges: Array<NetworkEdge> = [];
    for (const node of nodes.values()) {
        for (const { node: other, hopDistance } of reachableWaypoints(node, nodes, moveRadius, hubRadius)) {
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
