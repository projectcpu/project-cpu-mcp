import { defaultRouteGraphDirectory, writeRouteGraph } from './route.artifact.js';
import {
    DISTANCE_SCAN_CAP,
    NEXT_HOPS_NOTE,
    QUOTE_TOOL_NAME,
    ROUTE_AMOUNT_PATTERN,
    ROUTE_GRAPH_INSTRUCTIONS,
    ROUTE_GRAPH_SCHEMA_VERSION,
    ROUTE_NETWORK_NOTE,
} from './route.constants.js';
import {
    distancesFrom,
    endpointRefusal,
    incompleteSnapshotMessage,
    radiusPolicy,
    reachableWaypoints,
    relevantSubgraph,
    routeGraphEdges,
    routeGraphNodes,
    RouteEndpointRole,
    waypointNodes,
    waypointResolver,
    waypointTransitFee,
    widestReach,
    type NodeResolver,
    type RouteNode,
} from './route.utils.js';
import type {
    AppConfig,
    IAppConfig,
    NextHopsInput,
    NextHopsResult,
    NextHopView,
    RouteCellReader,
    RouteGraphArtifact,
    RouteNetworkInput,
    RouteNetworkResult,
    RouteRequestView,
    RouteServiceOptions,
} from './types.js';
import { BuildingKind } from '../api/types.js';
import { parseTokenId, tokenIdToPos } from '../geometry/token.utils.js';
import type { ILogger } from '../logger/types.js';
import type { Cell, RoutingSnapshot } from '../map/types.js';
import { formatUnixSeconds } from '../utils/format.utils.js';
import type { WalletProvider } from '../wallet/types.js';

export class RouteService {
    private readonly wallet: WalletProvider;
    private readonly appConfig: IAppConfig;
    private readonly mapReader: RouteCellReader;
    private readonly logger: ILogger;
    private readonly artifactDirectory: string;

    constructor(options: RouteServiceOptions) {
        this.wallet = options.wallet;
        this.appConfig = options.appConfig;
        this.mapReader = options.mapReader;
        this.logger = options.logger;
        this.artifactDirectory = options.artifactDirectory ?? defaultRouteGraphDirectory();
    }

    async nextHops(input: NextHopsInput): Promise<NextHopsResult> {
        const from = String(parseTokenId(input.from));
        const towards = input.towards === null ? null : String(parseTokenId(input.towards));
        if (from === towards) {
            throw new Error('`from` and `towards` must be different cells.');
        }

        const config = await this.appConfig.load();
        const routing = config.transport;
        this.assertTransportable(input.resourceId, routing.moveFeeFloors);
        const address = this.wallet.get().getAddress().toLowerCase();

        const policy = radiusPolicy(routing, config.buildings);
        const snapshot = await this.mapReader.routingSnapshot();
        this.assertComplete(snapshot);
        const cellsByToken = new Map(snapshot.cells.map((cell): [string, Cell] => [cell.tokenId, cell]));
        const nodes = waypointNodes(snapshot.cells, address, policy);
        const resolve = waypointResolver(nodes, new Set(cellsByToken.keys()), policy);

        const fromNode = this.assertEligible(from, resolve, cellsByToken, config);
        const fromCell = cellsByToken.get(from) ?? null;

        const reachable = reachableWaypoints(fromNode, resolve, widestReach(nodes, policy));

        let targetDistance: number | null = null;
        const toTarget = new Map<number, number>();
        if (towards !== null) {
            const targets = new Set<number>([Number(from), ...reachable.map((r) => Number(r.node.tokenId))]);
            for (const [token, distance] of distancesFrom(Number(towards), targets, DISTANCE_SCAN_CAP)) {
                toTarget.set(token, distance);
            }
            targetDistance = toTarget.get(Number(from)) ?? null;
        }

        const hops: Array<NextHopView> = reachable.map(({ node, hopDistance }) => {
            const cell = cellsByToken.get(node.tokenId) ?? null;
            return {
                tokenId: node.tokenId,
                pos: tokenIdToPos(node.tokenId),
                hopDistance,
                isOwn: node.isOwn,
                isHub: node.isHub,
                isVirgin: node.isVirgin,
                ready: cell === null ? null : cell.ready,
                owner: cell === null ? null : cell.owner,
                radius: node.radius,
                transitFeePerUnit: waypointTransitFee(
                    node,
                    cell === null ? null : cell.transitFeeOverrides,
                    input.resourceId,
                    routing.moveFeeFloors,
                ),
                distanceToTarget: towards === null ? null : (toTarget.get(Number(node.tokenId)) ?? null),
            };
        });
        hops.sort((a, b) => {
            if (towards !== null && a.distanceToTarget !== b.distanceToTarget) {
                return (a.distanceToTarget ?? Infinity) - (b.distanceToTarget ?? Infinity);
            }
            return a.hopDistance - b.hopDistance || Number(a.tokenId) - Number(b.tokenId);
        });

        this.logger.info('surveyed next hops', { from, towards, hops: hops.length, version: snapshot.version });
        return {
            from,
            fromIsHub: fromNode.isHub,
            fromIsVirgin: fromNode.isVirgin,
            fromReady: fromCell === null ? null : fromCell.ready,
            fromRadius: fromNode.radius,
            towards,
            targetDistance,
            hops,
            note: NEXT_HOPS_NOTE,
        };
    }

    async network(input: RouteNetworkInput): Promise<RouteNetworkResult> {
        const from = String(parseTokenId(input.from));
        const towards = String(parseTokenId(input.towards));
        if (from === towards) {
            throw new Error('`from` and `towards` must be different cells.');
        }
        this.assertAmount(input.amount);

        const config = await this.appConfig.load();
        const routing = config.transport;
        this.assertTransportable(input.resourceId, routing.moveFeeFloors);
        const address = this.wallet.get().getAddress().toLowerCase();

        const policy = radiusPolicy(routing, config.buildings);
        const snapshot = await this.mapReader.routingSnapshot();
        this.assertComplete(snapshot);
        const cellsByToken = new Map(snapshot.cells.map((cell): [string, Cell] => [cell.tokenId, cell]));
        this.assertEndpoint(from, RouteEndpointRole.Source, cellsByToken, address);
        this.assertEndpoint(towards, RouteEndpointRole.Target, cellsByToken, address);

        const nodes = routeGraphNodes(snapshot.cells, address, policy);
        const graph = relevantSubgraph(nodes, routeGraphEdges(nodes, policy), from, towards);

        const request: RouteRequestView = {
            from,
            towards,
            resourceId: input.resourceId,
            amount: input.amount,
        };
        const artifact: RouteGraphArtifact = {
            schemaVersion: ROUTE_GRAPH_SCHEMA_VERSION,
            snapshotVersion: snapshot.version,
            request,
            connected: graph.connected,
            nodes: graph.nodes.map((node) => {
                const cell = cellsByToken.get(node.tokenId) ?? null;
                return {
                    tokenId: node.tokenId,
                    owner: cell === null ? null : cell.owner,
                    isVirgin: node.isVirgin,
                    isOwn: node.isOwn,
                    isHub: node.isHub,
                    radius: node.radius,
                    transitFeePerUnit: waypointTransitFee(
                        node,
                        cell === null ? null : cell.transitFeeOverrides,
                        input.resourceId,
                        routing.moveFeeFloors,
                    ),
                };
            }),
            edges: graph.edges,
        };
        const artifactPath = await writeRouteGraph(artifact, this.artifactDirectory);

        this.logger.info('exported route graph', {
            version: snapshot.version,
            nodes: artifact.nodes.length,
            edges: artifact.edges.length,
            connected: artifact.connected,
        });
        return {
            artifactPath,
            schemaVersion: artifact.schemaVersion,
            snapshotVersion: artifact.snapshotVersion,
            request,
            connected: artifact.connected,
            nodeCount: artifact.nodes.length,
            edgeCount: artifact.edges.length,
            instructions: ROUTE_GRAPH_INSTRUCTIONS,
            quoteTemplate: {
                tool: QUOTE_TOOL_NAME,
                arguments: { path: [], resourceId: input.resourceId, amount: input.amount },
            },
            note: ROUTE_NETWORK_NOTE,
        };
    }

    private assertComplete(snapshot: RoutingSnapshot): void {
        if (!snapshot.complete) {
            throw new Error(incompleteSnapshotMessage(snapshot.droppedCells, snapshot.droppedUpdates));
        }
    }

    private assertAmount(amount: string): void {
        if (!ROUTE_AMOUNT_PATTERN.test(amount)) {
            throw new Error(`\`amount\` must be a positive integer string of units, got "${amount}".`);
        }
    }

    private assertEndpoint(tokenId: string, role: RouteEndpointRole, cells: Map<string, Cell>, address: string): void {
        const refusal = endpointRefusal(tokenId, role, cells.get(tokenId) ?? null, address);
        if (refusal !== null) {
            throw new Error(refusal);
        }
    }

    private assertTransportable(resourceId: number, floors: Record<number, string>): void {
        if (floors[resourceId] === undefined) {
            throw new Error(
                `Resource ${resourceId} does not exist or is not transportable: it has no transit-fee floor in ` +
                    'the loaded config. Check the id against cpu_get_game_config.',
            );
        }
    }

    private assertEligible(
        tokenId: string,
        resolve: NodeResolver,
        cells: Map<string, Cell>,
        config: AppConfig,
    ): RouteNode {
        const node = resolve(tokenId);
        if (node !== null) {
            return node;
        }
        // Only a held row can fail to resolve, and only by being controlled foreign land.
        const cell = cells.get(tokenId) as Cell;
        const building = cell.building;
        if (building !== null && building.buildFinishAt !== null && cell.ready === false) {
            const view = config.buildings.find((b) => b.type === building.type) ?? null;
            if (view !== null && view.kind === BuildingKind.Hub) {
                throw new Error(
                    `The ${view.name} on cell ${tokenId} is still under construction (ready ` +
                        `${formatUnixSeconds(building.buildFinishAt)}); it counts as a waypoint only once ` +
                        'construction finishes.',
                );
            }
        }
        throw new Error(
            `Cell ${tokenId} is not an eligible waypoint: it is foreign land past its first reveal and carries ` +
                'no finished Hub. Waypoints are open Virgin ground, cells you own, or any cell with a finished Hub.',
        );
    }
}
