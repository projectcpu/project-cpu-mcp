import { INCOMPLETE_SNAPSHOT_MESSAGE, UNREADABLE_ROWS_MESSAGE, UNREADABLE_UPDATES_MESSAGE } from './route.constants.js';
import { BuildingKind } from '../api/types.js';
import { neighbors } from '../geometry/adjacency.js';
import { MAX_TOKEN_ID, MIN_TOKEN_ID } from '../geometry/constants.js';
import { kRing } from '../geometry/graph.utils.js';

export interface RouteNode {
    tokenId: string;
    isOwn: boolean;
    isHub: boolean;
    /** Open ground: no completed reveal, so nobody controls it and any payer may route through it. */
    isVirgin: boolean;
    radius: number;
}

/** What a cell must expose to be classified as a waypoint: who holds it, and whether it is still open ground. */
export interface WaypointCell extends RadiusCell {
    tokenId: string;
    owner: string;
    revealCount: number;
}

export type NodeResolver = (tokenId: string) => RouteNode | null;

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

export function isVirginCell(cell: { revealCount: number }): boolean {
    return cell.revealCount === 0;
}

/**
 * The Intermediate-waypoint rule in one place: open ground, the payer's own land, or an Active Hub — anyone's.
 * A foreign cell past its first completed reveal without an Active Hub is controlled territory and no waypoint.
 */
export function waypointNode(cell: WaypointCell, address: string, policy: RadiusPolicy): RouteNode | null {
    const isOwn = cell.owner.toLowerCase() === address;
    const isVirgin = isVirginCell(cell);
    if (!isVirgin && !isOwn && !cell.activeHub) {
        return null;
    }
    return {
        tokenId: cell.tokenId,
        isOwn,
        isHub: cell.activeHub,
        isVirgin,
        radius: effectiveNodeRadius(cell, policy),
    };
}

export function waypointNodes(
    cells: ReadonlyArray<WaypointCell>,
    address: string,
    policy: RadiusPolicy,
): Map<string, RouteNode> {
    const nodes = new Map<string, RouteNode>();
    for (const cell of cells) {
        const node = waypointNode(cell, address, policy);
        if (node !== null) {
            nodes.set(cell.tokenId, node);
        }
    }
    return nodes;
}

/** Ground nobody has minted: unowned, unrevealed, no hub — legal to cross on ordinary move reach. */
export function unmintedNode(tokenId: string, policy: RadiusPolicy): RouteNode {
    return { tokenId, isOwn: false, isHub: false, isVirgin: true, radius: policy.moveRadius };
}

/**
 * Resolves any token id against one complete snapshot: a projected waypoint, unminted Virgin ground when the
 * snapshot holds no row for it, or nothing when the row exists but is controlled foreign territory.
 */
export function waypointResolver(
    nodes: ReadonlyMap<string, RouteNode>,
    mintedTokens: ReadonlySet<string>,
    policy: RadiusPolicy,
): NodeResolver {
    return (tokenId: string): RouteNode | null => {
        const node = nodes.get(tokenId);
        if (node !== undefined) {
            return node;
        }
        return mintedTokens.has(tokenId) ? null : unmintedNode(tokenId, policy);
    };
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

export function maxNodeRadius(nodes: ReadonlyMap<string, RouteNode>): number {
    let max = 0;
    for (const node of nodes.values()) {
        max = Math.max(max, node.radius);
    }
    return max;
}

/** The widest reach any candidate can contribute — open ground included, so no legal long hop is scanned past. */
export function widestReach(nodes: ReadonlyMap<string, RouteNode>, policy: RadiusPolicy): number {
    return Math.max(maxNodeRadius(nodes), policy.moveRadius);
}

export function reachableWaypoints(
    from: RouteNode,
    resolve: NodeResolver,
    widestRadius: number,
): Array<ReachableWaypoint> {
    const scan = Math.max(0, from.radius + widestRadius - 1);
    const result: Array<ReachableWaypoint> = [];
    for (const [token, distance] of kRing(Number(from.tokenId), scan)) {
        if (distance === 0) {
            continue;
        }
        const node = resolve(String(token));
        if (node === null || !isHopLegal(from, node, distance)) {
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

/**
 * Every Intermediate waypoint in the world, the payer's view of it: the snapshot's own rows where it holds
 * one, and unminted Virgin ground everywhere else. Safe only on a complete snapshot — a missing row would
 * otherwise pass for open ground.
 */
export function routeGraphNodes(
    cells: ReadonlyArray<WaypointCell>,
    address: string,
    policy: RadiusPolicy,
): Map<string, RouteNode> {
    const nodes = waypointNodes(cells, address, policy);
    const minted = new Set(cells.map((cell) => cell.tokenId));
    for (let token = MIN_TOKEN_ID; token <= MAX_TOKEN_ID; token++) {
        const tokenId = String(token);
        if (!minted.has(tokenId)) {
            nodes.set(tokenId, unmintedNode(tokenId, policy));
        }
    }
    return nodes;
}

/**
 * Every legal hop between the given nodes, once per unordered pair. The two scans are an optimization over
 * the whole world — ordinary move reach for all of them, the far wider Active-Hub reach only from the nodes
 * that carry it — but every pair emitted is still checked against the exact per-node reach rule.
 */
export function routeGraphEdges(nodes: ReadonlyMap<string, RouteNode>, policy: RadiusPolicy): Array<NetworkEdge> {
    const widest = widestReach(nodes, policy);
    const moveScan = Math.max(0, 2 * policy.moveRadius - 1);
    const found = new Map<string, NetworkEdge>();
    const collect = (node: RouteNode, scan: number): void => {
        for (const [token, distance] of kRing(Number(node.tokenId), scan)) {
            if (distance === 0) {
                continue;
            }
            const other = nodes.get(String(token));
            if (other === undefined || !isHopLegal(node, other, distance)) {
                continue;
            }
            const ascending = Number(other.tokenId) > Number(node.tokenId);
            const a = ascending ? node.tokenId : other.tokenId;
            const b = ascending ? other.tokenId : node.tokenId;
            found.set(`${a}:${b}`, { a, b, distance });
        }
    };
    for (const node of nodes.values()) {
        collect(node, moveScan);
        if (node.radius > policy.moveRadius) {
            collect(node, Math.max(0, node.radius + widest - 1));
        }
    }
    return [...found.values()].sort((x, y) => Number(x.a) - Number(y.a) || Number(x.b) - Number(y.b));
}

export function edgeAdjacency(edges: ReadonlyArray<NetworkEdge>): Map<string, Array<string>> {
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
    return adjacency;
}

export function componentOf(adjacency: ReadonlyMap<string, ReadonlyArray<string>>, start: string): Set<string> {
    const seen = new Set<string>([start]);
    let frontier = [start];
    while (frontier.length > 0) {
        const next: Array<string> = [];
        for (const current of frontier) {
            for (const neighbor of adjacency.get(current) ?? []) {
                if (!seen.has(neighbor)) {
                    seen.add(neighbor);
                    next.push(neighbor);
                }
            }
        }
        frontier = next;
    }
    return seen;
}

export interface RouteSubgraph {
    nodes: Array<RouteNode>;
    edges: Array<NetworkEdge>;
    connected: boolean;
}

/**
 * Cuts the world down to what the requested move can reach: the one component both endpoints share, or the
 * union of their two when nothing joins them. Topology relevant to neither endpoint is left out.
 */
export function relevantSubgraph(
    nodes: ReadonlyMap<string, RouteNode>,
    edges: ReadonlyArray<NetworkEdge>,
    from: string,
    towards: string,
): RouteSubgraph {
    const adjacency = edgeAdjacency(edges);
    const reached = componentOf(adjacency, from);
    const connected = reached.has(towards);
    if (!connected) {
        for (const token of componentOf(adjacency, towards)) {
            reached.add(token);
        }
    }
    const kept = [...nodes.values()]
        .filter((node) => reached.has(node.tokenId))
        .sort((x, y) => Number(x.tokenId) - Number(y.tokenId));
    return { nodes: kept, edges: edges.filter((edge) => reached.has(edge.a)), connected };
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

export enum RouteEndpointRole {
    Source = 'source',
    Target = 'target',
}

/** What a cell must expose to be judged as an endpoint. null stands for ground nobody has minted. */
export interface EndpointCell {
    owner: string;
    revealCount: number;
}

/**
 * The Route-endpoint rule, stricter than Intermediate-waypoint eligibility: the payer's own land, past its
 * first completed reveal. Returns the refusal, or null when the cell may carry an end of the shipment.
 */
export function endpointRefusal(
    tokenId: string,
    role: RouteEndpointRole,
    cell: EndpointCell | null,
    address: string,
): string | null {
    if (cell === null || isVirginCell(cell)) {
        return (
            `Cell ${tokenId} cannot be the ${role} of this shipment: it is Virgin ground with no completed ` +
            'reveal. A shipment starts and ends on your own revealed cells — Virgin ground is passage only.'
        );
    }
    if (cell.owner.toLowerCase() !== address) {
        return (
            `Cell ${tokenId} cannot be the ${role} of this shipment: it is not yours (owner ${cell.owner}). A ` +
            'shipment starts and ends on your own revealed cells — a foreign Active Hub is an Intermediate ' +
            'waypoint only, never an endpoint.'
        );
    }
    return null;
}

/** Tells a half-loaded map apart from one whose rows this client could not read — the remedies differ. */
export function incompleteSnapshotMessage(droppedCells: number, droppedUpdates: number): string {
    if (droppedCells > 0) {
        return `${UNREADABLE_ROWS_MESSAGE} Unreadable rows: ${droppedCells}.`;
    }
    if (droppedUpdates > 0) {
        return `${UNREADABLE_UPDATES_MESSAGE} Unreadable updates: ${droppedUpdates}.`;
    }
    return INCOMPLETE_SNAPSHOT_MESSAGE;
}
