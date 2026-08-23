import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { BuildingKind, BuildingType, type TransportRoutingView } from '../../../api/types.js';
import { neighbors } from '../../../geometry/adjacency.js';
import { MAX_TOKEN_ID } from '../../../geometry/constants.js';
import { kRing } from '../../../geometry/graph.utils.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { makeCell } from '../../../map/__tests__/fixtures.js';
import { toCell } from '../../../map/cell-view.utils.js';
import { toProjectionConfig } from '../../../map/reader.utils.js';
import type { RawCell } from '../../../map/types.js';
import {
    DEFAULT_SERVER_TIME,
    FakeAppConfig,
    makeConfig,
    WALLET_ADDRESS,
} from '../../../services/__tests__/service-fakes.js';
import {
    QUOTE_TOOL_NAME,
    ROUTE_GRAPH_INSTRUCTIONS,
    ROUTE_GRAPH_SCHEMA_VERSION,
    ROUTE_NETWORK_NOTE,
} from '../../../services/route.constants.js';
import { RouteService } from '../../../services/route.service.js';
import type {
    CatalogBuildingView,
    RouteGraphArtifact,
    RouteGraphNodeView,
    RouteNetworkResult,
} from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import {
    PANEL_CONTINUATION_INDENT,
    PANEL_LABEL_SEPARATOR,
    PANEL_MAX_LABEL_LENGTH,
    PANEL_MAX_WIDTH,
    PANEL_STRUCTURAL_SEQUENCES,
} from '../../../utils/panel.constants.js';
import type { WalletProvider } from '../../../wallet/types.js';
import type { ToolRegistrar } from '../../types.js';
import { ROUTE_NETWORK_DESCRIPTION, ROUTE_NETWORK_LABELS, ROUTE_NETWORK_TITLE } from '../network/constants.js';
import { registerRouteNetworkTool } from '../network/route-network.js';
import { routeNetworkInputSchema } from '../types.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Handler = (args: unknown) => Promise<ToolResult>;

const RIVAL = '0x000000000000000000000000000000000000beef';
const RES = 3;
const OTHER_RES = 9;
const AMOUNT = '250';
const FLOORS: Record<number, string> = { [RES]: '0.1', [OTHER_RES]: '0' };
const SNAPSHOT_VERSION = 4242;
const ORIGIN = 72;
const SCAN_CAP = 40;
const BASE_HUB = BuildingType.Hub;
const MID_HUB = 'hub_l2a';
const BASE_HUB_RADIUS = 5;
const MID_HUB_RADIUS = 8;
const MOVE_RADIUS = 1;
const DESCRIPTOR_CHAR_BUDGET = 8000;

function ringAt(origin: number, distance: number): Array<number> {
    return [...kRing(origin, distance)]
        .filter(([, step]) => step === distance)
        .map(([token]) => token)
        .sort((a, b) => a - b);
}

/** A cell exactly `distance` grid steps from the origin, so no assertion pins a world-specific token id. */
function at(distance: number, index = 0): string {
    const token = ringAt(ORIGIN, distance)[index];
    if (token === undefined) {
        throw new Error(`no cell sits ${distance} steps from ${ORIGIN}`);
    }
    return String(token);
}

const TARGET = at(2);

function own(tokenId: string, over: Partial<RawCell> = {}): RawCell {
    return makeCell({ tokenId, owner: WALLET_ADDRESS, revealCount: 1, ...over });
}

function withBuilding(type: string, buildFinishAt: number | null = null): Partial<RawCell> {
    return { building: { type, buildFinishAt, modeResource: null, modeRecipeId: null } };
}

function hub(tokenId: string, owner: string, type: string = BASE_HUB, over: Partial<RawCell> = {}): RawCell {
    return makeCell({ tokenId, owner, revealCount: 1, ...withBuilding(type), ...over });
}

function foreignHub(tokenId: string, fee: string, type: string = BASE_HUB, over: Partial<RawCell> = {}): RawCell {
    return hub(tokenId, RIVAL, type, { transitFeeOverrides: { [RES]: fee }, ...over });
}

/** Seals a cell off: every neighbour becomes foreign land past its first reveal, which is no waypoint at all. */
function walledOff(tokenId: string): Array<RawCell> {
    return neighbors(Number(tokenId)).map((token) =>
        makeCell({ tokenId: String(token), owner: RIVAL, revealCount: 1 }),
    );
}

function hubLadder(base: Array<CatalogBuildingView>): Array<CatalogBuildingView> {
    const entry = base.find((b) => b.kind === BuildingKind.Hub) as CatalogBuildingView;
    const tier = (type: string, onChainId: number, radius: number): CatalogBuildingView => ({
        ...entry,
        type: type as CatalogBuildingView['type'],
        onChainId,
        name: `Hub reaching ${radius}`,
        radius,
    });
    return [
        ...base.filter((b) => b.kind !== BuildingKind.Hub),
        tier(BASE_HUB, entry.onChainId, BASE_HUB_RADIUS),
        tier(MID_HUB, 96, MID_HUB_RADIUS),
    ];
}

function makeService(
    cells: Array<RawCell>,
    floors: Record<number, string> = FLOORS,
    transport: Partial<TransportRoutingView> = {},
    complete = true,
    directory: string | null = artifactDirectory,
): RouteService {
    const wallet = { get: () => ({ getAddress: () => WALLET_ADDRESS }) } as unknown as WalletProvider;
    const catalog = makeConfig();
    const config = {
        ...catalog,
        transport: { ...catalog.transport, moveFeeFloors: floors, ...transport },
        buildings: hubLadder(catalog.buildings),
    };
    const projection = toProjectionConfig(config);
    return new RouteService({
        wallet,
        appConfig: new FakeAppConfig(config),
        mapReader: {
            routingSnapshot: async () => ({
                cells: cells.map((c) => toCell(c, DEFAULT_SERVER_TIME, projection)),
                complete,
                droppedCells: 0,
                droppedUpdates: 0,
                version: SNAPSHOT_VERSION,
            }),
        },
        logger: new NoopLogger(),
        artifactDirectory: directory,
    });
}

function toolFor(service: unknown): Handler {
    const context = { route: service, logger: new NoopLogger() } as unknown as AppContext;
    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _definition: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    registerRouteNetworkTool(server, context);
    if (captured === null) {
        throw new Error('cpu_route_network was not registered');
    }
    return captured;
}

interface ExportArgs {
    from: number;
    towards: number;
    resourceId: number;
    amount: string;
}

function cellsFor(...extra: Array<RawCell>): Array<RawCell> {
    return [own(String(ORIGIN)), own(TARGET), ...extra];
}

function exportGraph(
    cells: Array<RawCell>,
    over: Partial<ExportArgs> = {},
    service: RouteService = makeService(cells),
): Promise<ToolResult> {
    return toolFor(service)({
        from: ORIGIN,
        towards: Number(TARGET),
        resourceId: RES,
        amount: AMOUNT,
        ...over,
    });
}

let artifactDirectory = '';

beforeEach(() => {
    artifactDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-cpu-mcp-test-'));
});

function descriptorOf(result: ToolResult): RouteNetworkResult {
    return JSON.parse(result.content[1]?.text ?? '') as RouteNetworkResult;
}

function artifactOf(descriptor: RouteNetworkResult): RouteGraphArtifact {
    return JSON.parse(fs.readFileSync(descriptor.artifactPath, 'utf8')) as RouteGraphArtifact;
}

async function exported(cells: Array<RawCell>, over: Partial<ExportArgs> = {}): Promise<RouteGraphArtifact> {
    return artifactOf(descriptorOf(await exportGraph(cells, over)));
}

function nodeOf(artifact: RouteGraphArtifact, tokenId: string): RouteGraphNodeView | null {
    return artifact.nodes.find((node) => node.tokenId === tokenId) ?? null;
}

function edgeOf(artifact: RouteGraphArtifact, a: string, b: string): boolean {
    const [low, high] = Number(a) < Number(b) ? [a, b] : [b, a];
    return artifact.edges.some((edge) => edge.a === low && edge.b === high);
}

function instructionsText(descriptor: RouteNetworkResult): string {
    return descriptor.instructions.join(' ');
}

afterEach(() => {
    fs.rmSync(artifactDirectory, { recursive: true, force: true });
});

describe('cpu_route_network request', () => {
    it('requires a source, a target, a resource and an amount, and takes no write path from the caller', () => {
        const schema = z.object(routeNetworkInputSchema);
        const full: Record<string, unknown> = {
            from: ORIGIN,
            towards: Number(TARGET),
            resourceId: RES,
            amount: AMOUNT,
        };

        expect(Object.keys(routeNetworkInputSchema).sort()).toEqual(['amount', 'from', 'resourceId', 'towards']);
        expect(schema.safeParse(full).success).toBe(true);
        for (const field of Object.keys(full)) {
            const partial = { ...full };
            delete partial[field];
            expect(schema.safeParse(partial).success).toBe(false);
        }
        expect(schema.safeParse({ ...full, amount: '0' }).success).toBe(false);
        expect(schema.safeParse({ ...full, amount: 'lots' }).success).toBe(false);
    });

    it('validates the whole request before it writes any graph: the move, the resource and both endpoints', async () => {
        const foreign = at(3);
        const unrevealed = at(4);
        const cells = cellsFor(
            makeCell({ tokenId: foreign, owner: RIVAL, revealCount: 1 }),
            own(unrevealed, { revealCount: 0 }),
        );

        await expect(exportGraph(cells, { towards: ORIGIN })).rejects.toThrow(/must be different/);
        await expect(exportGraph(cells, { resourceId: 999 })).rejects.toThrow(/does not exist or is not transportable/);
        await expect(exportGraph(cells, { from: Number(foreign) })).rejects.toThrow(/is not yours/);
        await expect(exportGraph(cells, { towards: Number(foreign) })).rejects.toThrow(/is not yours/);
        await expect(exportGraph(cells, { from: Number(unrevealed) })).rejects.toThrow(/no completed reveal/);
        await expect(exportGraph(cells, { towards: Number(unrevealed) })).rejects.toThrow(/no completed reveal/);

        expect(fs.readdirSync(artifactDirectory)).toEqual([]);
    });

    it('refuses to export before the whole map snapshot has loaded', async () => {
        const cells = cellsFor();

        await expect(exportGraph(cells, {}, makeService(cells, FLOORS, {}, false))).rejects.toThrow(/map bootstrap/);
    });
});

describe('cpu_route_network endpoints', () => {
    it('refuses an endpoint whose owner is not the authenticated payer, at the source and at the target', async () => {
        const foreign = at(3);
        const cells = cellsFor(makeCell({ tokenId: foreign, owner: RIVAL, revealCount: 1 }));

        await expect(exportGraph(cells, { from: Number(foreign) })).rejects.toThrow(/is not yours/);
        await expect(exportGraph(cells, { towards: Number(foreign) })).rejects.toThrow(/is not yours/);
    });

    it('refuses an endpoint with no completed reveal, minted or open ground nobody has minted', async () => {
        const unrevealed = at(3);
        const openGround = at(4);
        const cells = cellsFor(own(unrevealed, { revealCount: 0 }));

        await expect(exportGraph(cells, { from: Number(unrevealed) })).rejects.toThrow(/no completed reveal/);
        await expect(exportGraph(cells, { towards: Number(openGround) })).rejects.toThrow(/no completed reveal/);
    });

    it('rejects a foreign Active Hub as an endpoint but keeps it in the graph as an Intermediate waypoint', async () => {
        const hubCell = at(BASE_HUB_RADIUS);
        const cells = cellsFor(foreignHub(hubCell, '0.5'));

        await expect(exportGraph(cells, { towards: Number(hubCell) })).rejects.toThrow(/is not yours/);

        const artifact = await exported(cells);
        expect(nodeOf(artifact, hubCell)).toMatchObject({ isHub: true, isOwn: false, owner: RIVAL });
    });
});

describe('cpu_route_network artifact', () => {
    it('writes a versioned artifact: normalized request, snapshot version, nodes, canonical edges with distance', async () => {
        const result = await exportGraph(cellsFor());
        const descriptor = descriptorOf(result);
        const artifact = artifactOf(descriptor);

        expect(artifact.schemaVersion).toBe(ROUTE_GRAPH_SCHEMA_VERSION);
        expect(artifact.snapshotVersion).toBe(SNAPSHOT_VERSION);
        expect(artifact.request).toEqual({
            from: String(ORIGIN),
            towards: TARGET,
            resourceId: RES,
            amount: AMOUNT,
        });
        expect(artifact.nodes).toHaveLength(descriptor.nodeCount);
        expect(artifact.edges).toHaveLength(descriptor.edgeCount);

        const keys = artifact.edges.map((edge) => `${edge.a}:${edge.b}`);
        expect(new Set(keys).size).toBe(keys.length);
        for (const edge of artifact.edges.slice(0, 200)) {
            expect(Number(edge.a)).toBeLessThan(Number(edge.b));
            expect(edge.distance).toBe(MOVE_RADIUS);
            expect(neighbors(Number(edge.a))).toContain(Number(edge.b));
        }
        expect(edgeOf(artifact, String(ORIGIN), String(neighbors(ORIGIN)[0]))).toBe(true);
    });

    it('gives every node just the planning facts: token id, owner, Virgin/own/Active Hub, radius, resource fee', async () => {
        const hubCell = at(BASE_HUB_RADIUS);
        const mineUnrevealed = at(3);
        const openGround = at(4);
        const cells = cellsFor(own(mineUnrevealed, { revealCount: 0 }), foreignHub(hubCell, '0.5'));

        const artifact = await exported(cells);

        expect(Object.keys(nodeOf(artifact, String(ORIGIN)) as RouteGraphNodeView).sort()).toEqual([
            'isHub',
            'isOwn',
            'isVirgin',
            'owner',
            'radius',
            'tokenId',
            'transitFeePerUnit',
        ]);
        expect(nodeOf(artifact, hubCell)).toEqual({
            tokenId: hubCell,
            owner: RIVAL,
            isVirgin: false,
            isOwn: false,
            isHub: true,
            radius: BASE_HUB_RADIUS,
            transitFeePerUnit: '0.5',
        });
        expect(nodeOf(artifact, mineUnrevealed)).toMatchObject({
            isVirgin: true,
            isOwn: true,
            owner: WALLET_ADDRESS,
            radius: MOVE_RADIUS,
            transitFeePerUnit: null,
        });
        expect(nodeOf(artifact, openGround)).toMatchObject({
            owner: null,
            isVirgin: true,
            isOwn: false,
            isHub: false,
            radius: MOVE_RADIUS,
            transitFeePerUnit: null,
        });

        const forOther = await exported(cells, { resourceId: OTHER_RES });
        expect(nodeOf(forOther, hubCell)?.transitFeePerUnit).toBe(FLOORS[OTHER_RES]);
    });

    it('spans an edge with the radius a Ready Hub upgrade carries, and drops it while that same upgrade is still building', async () => {
        const landing = at(MID_HUB_RADIUS);
        const ready = [own(String(ORIGIN), withBuilding(MID_HUB)), own(TARGET), own(landing)];
        const going = [
            own(String(ORIGIN), withBuilding(MID_HUB, DEFAULT_SERVER_TIME + 1000)),
            own(TARGET),
            own(landing),
        ];

        const upgraded = await exported(ready);
        const underConstruction = await exported(going);

        expect(nodeOf(upgraded, String(ORIGIN))).toMatchObject({ isHub: true, radius: MID_HUB_RADIUS });
        expect(edgeOf(upgraded, String(ORIGIN), landing)).toBe(true);
        expect(nodeOf(underConstruction, String(ORIGIN))).toMatchObject({ isHub: false, radius: MOVE_RADIUS });
        expect(edgeOf(underConstruction, String(ORIGIN), landing)).toBe(false);
    });

    it('exports the one component both connected endpoints share and omits every unrelated component', async () => {
        const island = at(SCAN_CAP - 1);
        const wall = walledOff(island);
        const cells = cellsFor(own(island), ...wall);

        const artifact = await exported(cells);

        expect(artifact.connected).toBe(true);
        expect(nodeOf(artifact, String(ORIGIN))).not.toBeNull();
        expect(nodeOf(artifact, TARGET)).not.toBeNull();
        expect(nodeOf(artifact, island)).toBeNull();
        for (const closed of wall) {
            expect(nodeOf(artifact, closed.tokenId)).toBeNull();
        }
        expect(artifact.nodes).toHaveLength(MAX_TOKEN_ID - wall.length - 1);
    });

    it('exports the union of both endpoint components with connected false when no chain joins them', async () => {
        const wall = walledOff(String(ORIGIN));
        const cells = cellsFor(...wall);

        const descriptor = descriptorOf(await exportGraph(cells));
        const artifact = artifactOf(descriptor);

        expect(descriptor.connected).toBe(false);
        expect(artifact.connected).toBe(false);
        expect(nodeOf(artifact, String(ORIGIN))).not.toBeNull();
        expect(nodeOf(artifact, TARGET)).not.toBeNull();
        expect(artifact.edges.some((edge) => edge.a === String(ORIGIN) || edge.b === String(ORIGIN))).toBe(false);
        expect(artifact.nodes).toHaveLength(MAX_TOKEN_ID - wall.length);
    });

    it('writes each invocation to its own server-chosen unique filename in the directory it was given', async () => {
        const cells = cellsFor();

        const first = descriptorOf(await exportGraph(cells));
        const second = descriptorOf(await exportGraph(cells));

        expect(path.dirname(first.artifactPath)).toBe(artifactDirectory);
        expect(path.dirname(second.artifactPath)).toBe(artifactDirectory);
        expect(first.artifactPath).not.toBe(second.artifactPath);
        expect(path.basename(first.artifactPath)).toMatch(/^[\w-]+\.json$/);
        expect(fs.existsSync(first.artifactPath)).toBe(true);
        expect(fs.existsSync(second.artifactPath)).toBe(true);
        expect(Object.keys(routeNetworkInputSchema)).not.toContain('path');
    });

    it('falls back to the operating system temporary directory when no directory is configured', async () => {
        const cells = cellsFor();
        const service = makeService(cells, FLOORS, {}, true, null);

        const descriptor = descriptorOf(await exportGraph(cells, {}, service));

        try {
            expect(path.dirname(descriptor.artifactPath)).toBe(os.tmpdir());
        } finally {
            fs.rmSync(descriptor.artifactPath, { force: true });
        }
    });
});

describe('cpu_route_network response', () => {
    it('answers with a descriptor, counts, connectivity, instructions and a quote template, no graph bytes inline', async () => {
        const result = await exportGraph(cellsFor());
        const descriptor = descriptorOf(result);
        const artifact = artifactOf(descriptor);
        const inline = result.content.map((block) => block.text).join('\n');

        expect(Object.keys(descriptor).sort()).toEqual([
            'artifactPath',
            'connected',
            'edgeCount',
            'instructions',
            'nodeCount',
            'note',
            'quoteTemplate',
            'request',
            'schemaVersion',
            'snapshotVersion',
        ]);
        expect(descriptor.nodeCount).toBe(artifact.nodes.length);
        expect(descriptor.edgeCount).toBe(artifact.edges.length);
        expect(descriptor.connected).toBe(true);
        expect(descriptor.nodeCount).toBeGreaterThan(1000);

        expect(inline.length).toBeLessThan(DESCRIPTOR_CHAR_BUDGET);
        expect(inline).not.toContain('"nodes"');
        expect(inline).not.toContain('"edges"');
        expect(fs.statSync(descriptor.artifactPath).size).toBeGreaterThan(inline.length * 10);
    });

    it('prefills the quote template with the resource and the amount, leaving the path for the agent', async () => {
        const descriptor = descriptorOf(await exportGraph(cellsFor()));

        expect(descriptor.quoteTemplate).toEqual({
            tool: QUOTE_TOOL_NAME,
            arguments: { path: [], resourceId: RES, amount: AMOUNT },
        });

        const text = instructionsText(descriptor);
        expect(text).toMatch(/quoteTemplate/);
        expect(text).toMatch(/path/i);
    });

    it('instructs: a raw graph loaded with code, never printed, no repeated node, re-export when stale', async () => {
        const descriptor = descriptorOf(await exportGraph(cellsFor()));
        const text = instructionsText(descriptor);

        expect(descriptor.instructions).toEqual([...ROUTE_GRAPH_INSTRUCTIONS]);
        expect(text).toMatch(/raw route graph/i);
        expect(text).toMatch(/with code/i);
        expect(text).toMatch(/never print/i);
        expect(text).toMatch(/only the nodes and edges/i);
        expect(text).toMatch(/no node twice/i);
        expect(text).toMatch(/stale/i);
        expect(text).toMatch(/export a fresh graph/i);
    });

    it('instructs: preference becomes its own path cost, else fastest, nominal-cheapest and balanced by exact arithmetic', async () => {
        const descriptor = descriptorOf(await exportGraph(cellsFor()));
        const text = instructionsText(descriptor);

        expect(text).toMatch(/cost function/i);
        expect(text).toMatch(/fastest/i);
        expect(text).toMatch(/cheapest/i);
        expect(text).toMatch(/balanced/i);
        expect(text).toMatch(/exact decimal|scaled-integer/i);
        expect(text).toMatch(/floating point/i);
    });

    it('requires the shortlist quoted, since live Syndicate discounts reorder paths, and guarantees no transport', async () => {
        const descriptor = descriptorOf(await exportGraph(cellsFor()));
        const text = instructionsText(descriptor);

        expect(text).toMatch(/shortlist/i);
        expect(text).toMatch(/Syndicate/);
        expect(text).toMatch(/does not promise/i);
        expect(text).toMatch(/never automatically/i);
        expect(text).not.toMatch(/guarantees the transfer|guarantees the transport/i);
    });

    it('instructs: every candidate reported with its distance, nominal fee, waypoint count and foreign Hubs', async () => {
        const descriptor = descriptorOf(await exportGraph(cellsFor()));
        const text = instructionsText(descriptor);

        expect(text).toMatch(/with every candidate/i);
        expect(text).toMatch(/total distance/i);
        expect(text).toMatch(/total nominal fee/i);
        expect(text).toMatch(/waypoint count/i);
        expect(text).toMatch(/foreign Hubs it routes through/i);
    });

    it('describes the fee-charging Hubs by flags that select exactly those nodes in the artifact', async () => {
        const mine = at(1);
        const rival = at(1, 1);
        const descriptor = descriptorOf(
            await exportGraph(cellsFor(hub(mine, WALLET_ADDRESS), foreignHub(rival, '0.5'))),
        );
        const artifact = artifactOf(descriptor);
        const sentence = descriptor.instructions.find((line) => line.includes('foreign Hubs it routes through')) ?? '';
        const claimed = new Map(
            [...sentence.matchAll(/`(isHub|isOwn)` (true|false)/g)].map((match) => [match[1], match[2] === 'true']),
        );
        const selected = artifact.nodes
            .filter(
                (node) =>
                    node.isHub === claimed.get('isHub') &&
                    node.isOwn === claimed.get('isOwn') &&
                    node.transitFeePerUnit !== null,
            )
            .map((node) => node.tokenId);

        expect([...claimed.keys()].sort()).toEqual(['isHub', 'isOwn']);
        expect(nodeOf(artifact, mine)).toMatchObject({ isHub: true, isOwn: true, transitFeePerUnit: null });
        expect(nodeOf(artifact, rival)).toMatchObject({ isHub: true, isOwn: false, transitFeePerUnit: '0.5' });
        expect(selected).toEqual([rival]);
    });

    it('tells the agent to report a disconnected pair instead of inventing a chain', async () => {
        const descriptor = descriptorOf(await exportGraph(cellsFor(...walledOff(String(ORIGIN)))));

        expect(descriptor.connected).toBe(false);
        expect(instructionsText(descriptor)).toMatch(/no chain exists/i);
    });

    it('never calls a node free in the instructions while the same artifact bills a fee for it', async () => {
        const fee = '17';
        const standing = at(1);
        const descriptor = descriptorOf(
            await exportGraph(cellsFor(foreignHub(standing, fee, BASE_HUB, { revealCount: 0 }))),
        );
        const artifact = artifactOf(descriptor);
        const billed = artifact.nodes.filter((node) => node.isVirgin && node.transitFeePerUnit !== null);
        const text = instructionsText(descriptor);

        expect(nodeOf(artifact, standing)).toMatchObject({ isVirgin: true, isHub: true, transitFeePerUnit: fee });
        expect(billed).toHaveLength(1);
        expect(text).toMatch(/`transitFeePerUnit: null` costs nothing/);
        expect(text).toMatch(/charges its fee even where `isVirgin` is true/);
        expect(text).toMatch(/no\s+flag on its own makes a node free/);
        expect(text).not.toMatch(/Virgin ground costs? nothing/);
    });
});

describe('route_network description', () => {
    it('states reach per cell and per Hub tier, never the one global balance the old world had', () => {
        expect(ROUTE_NETWORK_DESCRIPTION).toMatch(/radius\(a\)\+radius\(b\)−1 grid steps/);
        expect(ROUTE_NETWORK_DESCRIPTION).toMatch(/a finished Hub tier reaches as far as its own catalog row serves/);
        expect(ROUTE_NETWORK_DESCRIPTION).toMatch(/its own reach\s+radius/);
        expect(ROUTE_NETWORK_DESCRIPTION).not.toMatch(/own↔own 1|own↔hub 3|hub↔hub 5/);
    });

    it('states which cells are nodes: Virgin ground, your own, any finished Hub — foreign revealed land closed', () => {
        expect(ROUTE_NETWORK_DESCRIPTION).toMatch(/Virgin ground \(no completed reveal, minted\s+or not/);
        expect(ROUTE_NETWORK_DESCRIPTION).toMatch(/any cell with a finished Hub, foreign\s+ones included/);
        expect(ROUTE_NETWORK_DESCRIPTION).toMatch(
            /only foreign land past its first reveal without a finished Hub is closed/,
        );
        expect(ROUTE_NETWORK_DESCRIPTION).not.toContain('Foreign cells are never nodes');
        expect(ROUTE_NETWORK_DESCRIPTION).not.toMatch(/your own cells stay nodes/);
    });
});

const PANEL_LABELS = Object.values(ROUTE_NETWORK_LABELS);

function descriptor(over: Partial<RouteNetworkResult> = {}): RouteNetworkResult {
    return {
        artifactPath: '/tmp/cpu-route-graph-1.json',
        schemaVersion: 1,
        snapshotVersion: SNAPSHOT_VERSION,
        request: { from: '10', towards: '30', resourceId: RES, amount: AMOUNT },
        connected: true,
        nodeCount: 12,
        edgeCount: 24,
        instructions: ['Load the raw route graph with code.'],
        quoteTemplate: { tool: QUOTE_TOOL_NAME, arguments: { path: [], resourceId: RES, amount: AMOUNT } },
        note: NOTE,
        ...over,
    };
}

const NOTE = 'A raw route graph on disk, not a route. Verify with cpu_quote_transport.';

const ARGS = { from: 10, towards: 30, resourceId: RES, amount: AMOUNT };

function panelHarness(result: RouteNetworkResult): Handler {
    return toolFor({ network: async (): Promise<RouteNetworkResult> => result });
}

function panelOf(result: ToolResult): string {
    return result.content[0]?.text ?? '';
}

function labelSeparators(panel: string): number {
    return panel.split(PANEL_LABEL_SEPARATOR).length - 1;
}

function unwrapped(panel: string): string {
    return panel
        .split('\n')
        .reduce((text, line) =>
            line.startsWith(PANEL_CONTINUATION_INDENT) ? `${text} ${line.trim()}` : `${text}\n${line}`,
        );
}

function flattened(panel: string): string {
    return panel
        .split('\n')
        .map((line) => line.trim())
        .join('');
}

function panelLabels(panel: string): Array<string> {
    return panel
        .split('\n')
        .slice(1)
        .flatMap((line) => line.trim().split(' | '))
        .map((field) => field.split(': ')[0] ?? '')
        .filter((label) => PANEL_LABELS.includes(label));
}

describe('route_network panel', () => {
    it('opens with the same title and the same fields in the same order on every input', async () => {
        const panels = [
            panelOf(await panelHarness(descriptor())(ARGS)),
            panelOf(await panelHarness(descriptor({ connected: false }))(ARGS)),
            panelOf(await panelHarness(descriptor({ nodeCount: 0, edgeCount: 0 }))(ARGS)),
        ];

        for (const panel of panels) {
            expect(panel.split('\n')[0]).toBe(ROUTE_NETWORK_TITLE);
            expect(panelLabels(panel)).toEqual(PANEL_LABELS);
            expect(labelSeparators(panel)).toBe(PANEL_LABELS.length);
        }
    });

    it('keeps every line inside the panel width, whatever the values are', async () => {
        const panels = [
            panelOf(await panelHarness(descriptor())(ARGS)),
            panelOf(await panelHarness(descriptor({ note: 'q'.repeat(400) }))(ARGS)),
            panelOf(await panelHarness(descriptor({ artifactPath: `/tmp/${'g'.repeat(200)}.json` }))(ARGS)),
        ];

        for (const panel of panels) {
            for (const line of panel.split('\n')) {
                expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
            }
        }
    });

    it('names the artifact, its schema, the snapshot behind it and how big the graph is', async () => {
        const panel = panelOf(await panelHarness(descriptor())(ARGS));

        expect(panel).toMatch(/\/tmp\/cpu-route-graph-1\.json/);
        expect(panel).toMatch(/Schema: 1/);
        expect(panel).toMatch(new RegExp(`Snapshot: ${SNAPSHOT_VERSION}`));
        expect(panel).toMatch(/Waypoints: 12/);
        expect(panel).toMatch(/Legal hops: 24/);
    });

    it('reports a connected pair as a chain to compute and a split pair as a gap', async () => {
        const linked = panelOf(await panelHarness(descriptor())(ARGS));
        const split = panelOf(await panelHarness(descriptor({ connected: false }))(ARGS));

        expect(panelOf(await panelHarness(descriptor())(ARGS))).toMatch(/From: 10/);
        expect(linked).toMatch(/Towards: 30/);
        expect(flattened(linked)).toMatch(/one graph/);
        expect(flattened(split)).toMatch(/NOT connected/);
    });

    it('carries the note the tool already returns, word for word', async () => {
        const panel = panelOf(await panelHarness(descriptor())(ARGS));

        expect(unwrapped(panel)).toContain(NOTE);
    });

    it('renders the note the route service actually sends without mangling a character of it', async () => {
        const panel = panelOf(await panelHarness(descriptor({ note: ROUTE_NETWORK_NOTE }))(ARGS));

        expect(unwrapped(panel)).toContain(ROUTE_NETWORK_NOTE);
    });

    it('lets the note forge no line, no column and no field', async () => {
        const clean = panelOf(await panelHarness(descriptor({ note: 'road map forged' }))(ARGS));

        for (const probe of PANEL_STRUCTURAL_SEQUENCES) {
            const panel = panelOf(await panelHarness(descriptor({ note: `road map${probe}forged` }))(ARGS));

            expect(panel.split('\n')).toHaveLength(clean.split('\n').length);
            expect(labelSeparators(panel)).toBe(labelSeparators(clean));
            expect(panel.split('|')).toHaveLength(clean.split('|').length);
        }
    });

    it('lets the note forge no field even when the panel is read unwrapped', async () => {
        for (let offset = 40; offset < 72; offset += 1) {
            const note = `${'b'.repeat(offset)}:${'c'.repeat(30)}`;
            const panel = panelOf(await panelHarness(descriptor({ note }))(ARGS));

            expect(labelSeparators(unwrapped(panel))).toBe(PANEL_LABELS.length);
            expect(flattened(panel)).toContain(`Note: ${note}`);
            for (const line of panel.split('\n')) {
                expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
            }
        }
    });

    it('keeps its own labels inside the label ceiling the builder documents', () => {
        for (const label of PANEL_LABELS) {
            expect(label.length).toBeLessThanOrEqual(PANEL_MAX_LABEL_LENGTH);
        }
    });

    it('leaves the machine block untouched next to the panel', async () => {
        const result = await panelHarness(descriptor())(ARGS);

        expect(result.content).toHaveLength(2);
        expect(result.content[1]?.type).toBe('text');
        expect(result.content[1]?.text).toBe(JSON.stringify(descriptor()));
    });
});
