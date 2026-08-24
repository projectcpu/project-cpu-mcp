import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_SERVER_TIME, FakeAppConfig, makeConfig, WALLET_ADDRESS } from './service-fakes.js';
import { BuildingKind, BuildingType, type TransportRoutingView } from '../../api/types.js';
import { neighbors } from '../../geometry/adjacency.js';
import { MAX_TOKEN_ID } from '../../geometry/constants.js';
import { kRing } from '../../geometry/graph.utils.js';
import { tokenIdToPos } from '../../geometry/token.utils.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { makeCell } from '../../map/__tests__/fixtures.js';
import { toCell } from '../../map/cell-view.utils.js';
import { toProjectionConfig } from '../../map/reader.utils.js';
import type { RawCell } from '../../map/types.js';
import { formatUnixSeconds } from '../../utils/format.utils.js';
import type { WalletProvider } from '../../wallet/types.js';
import { RouteService } from '../route.service.js';
import type {
    CatalogBuildingView,
    NextHopsResult,
    NextHopView,
    RouteGraphArtifact,
    RouteGraphNodeView,
    RouteNetworkInput,
    RouteNetworkResult,
} from '../types.js';

const RIVAL = '0x000000000000000000000000000000000000beef';
const RES = 3;
const AMOUNT = '250';
const DEFAULT_FLOORS: Record<number, string> = { 3: '0', 9: '0' };
const UNFINISHED_AT = DEFAULT_SERVER_TIME + 1000;

const BASE_HUB = BuildingType.Hub;
const MID_HUB = 'hub_l2a';
const TOP_HUB = 'hub_l3a';
const BASE_HUB_RADIUS = 5;
const MID_HUB_RADIUS = 8;
const TOP_HUB_RADIUS = 13;

const ORIGIN = 72;
const SCAN_CAP = 40;

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

function gridDistance(a: string, b: string): number {
    const step = kRing(Number(a), SCAN_CAP).get(Number(b));
    if (step === undefined) {
        throw new Error(`${a} and ${b} are more than ${SCAN_CAP} steps apart`);
    }
    return step;
}

/** A cell far enough from the origin that no configured radius can bridge the gap. */
function farAway(): string {
    return at(SCAN_CAP - 1);
}

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
        tier(TOP_HUB, 97, TOP_HUB_RADIUS),
    ];
}

const SNAPSHOT_VERSION = 4242;

let artifactDirectory = '';

beforeEach(() => {
    artifactDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'project-cpu-mcp-test-'));
});

function makeService(
    cells: Array<RawCell>,
    moveFeeFloors: Record<number, string> = DEFAULT_FLOORS,
    transport: Partial<TransportRoutingView> = {},
    complete = true,
    droppedCells = 0,
    droppedUpdates = 0,
): RouteService {
    const wallet = { get: () => ({ getAddress: () => WALLET_ADDRESS }) } as unknown as WalletProvider;
    const base = makeConfig();
    const config = {
        ...base,
        transport: { ...base.transport, moveFeeFloors, ...transport },
        buildings: hubLadder(base.buildings),
    };
    const projection = toProjectionConfig(config);
    return new RouteService({
        wallet,
        appConfig: new FakeAppConfig(config),
        mapReader: {
            routingSnapshot: async () => ({
                cells: cells.map((c) => toCell(c, DEFAULT_SERVER_TIME, projection)),
                complete,
                droppedCells,
                droppedUpdates,
                version: SNAPSHOT_VERSION,
            }),
        },
        logger: new NoopLogger(),
        artifactDirectory,
    });
}

function survey(cells: Array<RawCell>, from: number, towards: number | null = null, resourceId = RES) {
    return makeService(cells).nextHops({ from, towards, resourceId });
}

/** Token ids of the candidates that are not open Virgin ground — the cells an assertion names one by one. */
function settled(result: NextHopsResult): Array<string> {
    return result.hops.filter((hop) => !hop.isVirgin).map((hop) => hop.tokenId);
}

function hopFor(result: NextHopsResult, tokenId: string): NextHopView | null {
    return result.hops.find((hop) => hop.tokenId === tokenId) ?? null;
}

function exportInput(over: Partial<RouteNetworkInput> = {}): RouteNetworkInput {
    return { from: ORIGIN, towards: Number(at(2)), resourceId: RES, amount: AMOUNT, ...over };
}

function graphOf(result: RouteNetworkResult): RouteGraphArtifact {
    return JSON.parse(fs.readFileSync(result.artifactPath, 'utf8')) as RouteGraphArtifact;
}

function nodeOf(graph: RouteGraphArtifact, tokenId: string): RouteGraphNodeView | null {
    return graph.nodes.find((node) => node.tokenId === tokenId) ?? null;
}

function edgeOf(graph: RouteGraphArtifact, a: string, b: string): boolean {
    const [low, high] = Number(a) < Number(b) ? [a, b] : [b, a];
    return graph.edges.some((edge) => edge.a === low && edge.b === high && edge.distance === gridDistance(a, b));
}

afterEach(() => {
    fs.rmSync(artifactDirectory, { recursive: true, force: true });
});

describe('RouteService.nextHops', () => {
    it('lists own cells within move reach and hubs within their own reach, with their facts', async () => {
        const neighbour = at(1);
        const hubCell = at(BASE_HUB_RADIUS);
        const cells = [own(String(ORIGIN)), own(neighbour), own(at(2)), foreignHub(hubCell, '0.5')];

        const result = await survey(cells, ORIGIN);

        expect(result.from).toBe(String(ORIGIN));
        expect(result.fromIsHub).toBe(false);
        expect(result.fromRadius).toBe(1);
        expect(settled(result)).toEqual([neighbour, hubCell]);
        expect(hopFor(result, neighbour)).toMatchObject({
            tokenId: neighbour,
            hopDistance: 1,
            isOwn: true,
            radius: 1,
            transitFeePerUnit: null,
        });
        expect(hopFor(result, hubCell)).toMatchObject({
            tokenId: hubCell,
            hopDistance: BASE_HUB_RADIUS,
            isHub: true,
            radius: BASE_HUB_RADIUS,
            owner: RIVAL,
            transitFeePerUnit: '0.5',
        });
        expect(hopFor(result, hubCell)?.pos).toEqual(tokenIdToPos(hubCell));
    });

    it('resolves the transit fee for the requested resource: override for it, its floor otherwise', async () => {
        const hubCell = at(BASE_HUB_RADIUS);
        const cells = [own(String(ORIGIN)), foreignHub(hubCell, '0.5')];

        const forRes3 = await survey(cells, ORIGIN, null, 3);
        expect(forRes3.hops.find((h) => h.tokenId === hubCell)?.transitFeePerUnit).toBe('0.5');

        const forRes9 = await makeService(cells, { 3: '0', 9: '0.2' }).nextHops({
            from: ORIGIN,
            towards: null,
            resourceId: 9,
        });
        expect(forRes9.hops.find((h) => h.tokenId === hubCell)?.transitFeePerUnit).toBe('0.2');
    });

    it('rejects a resource id that has no floor row in the config before any route work', async () => {
        await expect(survey([own(String(ORIGIN)), foreignHub(at(3), '0.5')], ORIGIN, null, 999)).rejects.toThrow(
            /does not exist or is not transportable/,
        );
    });

    it('adds a compass when towards is given and sorts by remaining distance', async () => {
        const neighbour = at(1);
        const hubCell = at(BASE_HUB_RADIUS);
        const target = at(BASE_HUB_RADIUS + 1);
        const cells = [own(String(ORIGIN)), own(neighbour), own(target), foreignHub(hubCell, '0.5')];

        const result = await survey(cells, ORIGIN, Number(target));

        expect(result.targetDistance).toBe(gridDistance(String(ORIGIN), target));
        expect(result.hops[0]?.distanceToTarget).toBe(gridDistance(result.hops[0]?.tokenId ?? '', target));
        const remaining = result.hops.map((h) => h.distanceToTarget ?? Infinity);
        expect([...remaining].sort((a, b) => a - b)).toEqual(remaining);
    });

    it('returns no settled waypoint when nothing is within reach — the agent decides what to do', async () => {
        const target = farAway();
        const result = await survey([own(String(ORIGIN)), own(target)], ORIGIN, Number(target));

        expect(settled(result)).toEqual([]);
        expect(result.targetDistance).toBe(gridDistance(String(ORIGIN), target));
    });

    it('reaches farther when surveying from a hub', async () => {
        const inReach = at(BASE_HUB_RADIUS);
        const outOfReach = at(BASE_HUB_RADIUS + 1);
        const cells = [hub(String(ORIGIN), WALLET_ADDRESS), own(inReach), own(outOfReach)];

        const result = await survey(cells, ORIGIN);

        expect(result.fromIsHub).toBe(true);
        expect(result.fromReady).toBe(true);
        expect(result.fromRadius).toBe(BASE_HUB_RADIUS);
        expect(settled(result)).toEqual([inReach]);
        expect(hopFor(result, inReach)?.hopDistance).toBe(BASE_HUB_RADIUS);
        expect(result.hops.map((h) => h.tokenId)).not.toContain(outOfReach);
    });

    it('reaches a ready hub upgrade with the radius that upgrade carries, not the base hub radius', async () => {
        const beyondBase = at(MID_HUB_RADIUS);
        const upgraded = foreignHub(beyondBase, '0.5', MID_HUB);
        const base = foreignHub(beyondBase, '0.5', BASE_HUB);

        const withUpgrade = await survey([own(String(ORIGIN)), upgraded], ORIGIN);
        const withBase = await survey([own(String(ORIGIN)), base], ORIGIN);

        expect(settled(withUpgrade)).toEqual([beyondBase]);
        expect(hopFor(withUpgrade, beyondBase)).toMatchObject({
            hopDistance: MID_HUB_RADIUS,
            radius: MID_HUB_RADIUS,
            isHub: true,
            ready: true,
            transitFeePerUnit: '0.5',
        });
        expect(settled(withBase)).toEqual([]);
    });

    it('keeps every rung of the hub ladder apart instead of granting one shared hub reach', async () => {
        const topOnly = at(TOP_HUB_RADIUS);

        const top = await survey([own(String(ORIGIN)), foreignHub(topOnly, '0.5', TOP_HUB)], ORIGIN);
        const mid = await survey([own(String(ORIGIN)), foreignHub(topOnly, '0.5', MID_HUB)], ORIGIN);

        expect(settled(top)).toEqual([topOnly]);
        expect(hopFor(top, topOnly)?.radius).toBe(TOP_HUB_RADIUS);
        expect(settled(mid)).toEqual([]);
    });

    it('holds the two-endpoint reach rule exactly at the limit and one step beyond it', async () => {
        const origin = hub(String(ORIGIN), WALLET_ADDRESS, MID_HUB);
        const limit = MID_HUB_RADIUS + BASE_HUB_RADIUS - 1;
        const atLimit = at(limit);
        const beyondLimit = at(limit + 1);

        const result = await survey([origin, foreignHub(atLimit, '0.5'), foreignHub(beyondLimit, '0.5')], ORIGIN);

        expect(settled(result)).toEqual([atLimit]);
        expect(hopFor(result, atLimit)?.hopDistance).toBe(limit);
        expect(result.hops.map((h) => h.tokenId)).not.toContain(beyondLimit);
    });

    it('follows a move radius that is not the launch value', async () => {
        const cells = [own(String(ORIGIN)), own(at(3)), own(at(4))];

        const result = await makeService(cells, DEFAULT_FLOORS, { moveRadius: 2 }).nextHops({
            from: ORIGIN,
            towards: null,
            resourceId: RES,
        });

        expect(result.fromRadius).toBe(2);
        expect(settled(result)).toEqual([at(3)]);
        expect(result.hops.map((h) => h.tokenId)).not.toContain(at(4));
    });

    it('saturates a zero move radius at no reach while a hub still reaches out of it', async () => {
        const plain = [own(String(ORIGIN)), own(at(1))];
        const stranded = await makeService(plain, DEFAULT_FLOORS, { moveRadius: 0 }).nextHops({
            from: ORIGIN,
            towards: null,
            resourceId: RES,
        });
        expect(stranded.hops).toEqual([]);

        const landing = at(BASE_HUB_RADIUS - 1);
        const bridged = await makeService([own(String(ORIGIN)), foreignHub(landing, '0.5')], DEFAULT_FLOORS, {
            moveRadius: 0,
        }).nextHops({ from: ORIGIN, towards: null, resourceId: RES });
        expect(bridged.hops.map((h) => h.tokenId)).toEqual([landing]);
    });

    it('skips a foreign hub that is still under construction — it is no waypoint yet', async () => {
        const unfinished = foreignHub(at(BASE_HUB_RADIUS), '0.5', BASE_HUB, withBuilding(BASE_HUB, UNFINISHED_AT));

        const result = await survey([own(String(ORIGIN)), unfinished], ORIGIN);

        expect(settled(result)).toEqual([]);
    });

    it('denies a hub upgrade under construction both its reach and its fee until it is ready', async () => {
        const spot = at(MID_HUB_RADIUS);
        const goingUp = own(spot, { ...withBuilding(MID_HUB, UNFINISHED_AT), transitFeeOverrides: { [RES]: '0.5' } });

        const unfinished = await survey([own(String(ORIGIN)), goingUp], ORIGIN);
        expect(settled(unfinished)).toEqual([]);

        const finished = await survey(
            [own(String(ORIGIN)), own(spot, { ...withBuilding(MID_HUB), transitFeeOverrides: { [RES]: '0.5' } })],
            ORIGIN,
        );
        expect(settled(finished)).toEqual([spot]);
        expect(hopFor(finished, spot)?.radius).toBe(MID_HUB_RADIUS);
    });

    it('keeps an owned cell whose hub is still going up as an origin, with normal reach and no hub bonus', async () => {
        const neighbour = at(1);
        const cells = [
            own(String(ORIGIN), { ...withBuilding(MID_HUB, UNFINISHED_AT), transitFeeOverrides: { [RES]: '0.5' } }),
            own(neighbour),
            own(at(BASE_HUB_RADIUS)),
        ];

        const result = await survey(cells, ORIGIN);

        expect(result.fromIsHub).toBe(false);
        expect(result.fromReady).toBe(false);
        expect(result.fromRadius).toBe(1);
        expect(settled(result)).toEqual([neighbour]);
    });

    it('states the reach rule as the two-endpoint sum instead of one universal hub reach', async () => {
        const result = await survey([own(String(ORIGIN)), own(at(1))], ORIGIN);

        expect(result.note).toContain('radius(from)+radius(to)−1');
        expect(result.note).toMatch(/its own tier serves/);
    });

    it('reports a bare waypoint as ready: null rather than not-ready', async () => {
        const result = await survey([own(String(ORIGIN)), own(at(1))], ORIGIN);

        expect(result.fromReady).toBeNull();
        expect(hopFor(result, at(1))?.ready).toBeNull();
    });

    it('rejects routing from a hub still under construction, naming when it will be ready', async () => {
        const spot = at(BASE_HUB_RADIUS);
        const unfinished = foreignHub(spot, '0.5', BASE_HUB, withBuilding(BASE_HUB, UNFINISHED_AT));

        await expect(survey([own(String(ORIGIN)), unfinished], Number(spot))).rejects.toThrow(
            `The Hub reaching ${BASE_HUB_RADIUS} on cell ${spot} is still under construction (ready ` +
                `${formatUnixSeconds(UNFINISHED_AT)}); it counts as a waypoint only once construction finishes.`,
        );
    });

    it('rejects ineligible origins and token ids outside the world with specific errors', async () => {
        const foreign = at(1);
        const unrevealed = at(2);
        const cells = [
            own(String(ORIGIN)),
            makeCell({ tokenId: foreign, owner: RIVAL, revealCount: 1 }),
            own(unrevealed, { revealCount: 0 }),
        ];

        await expect(survey(cells, MAX_TOKEN_ID + 1)).rejects.toThrow(/tokenId must be an integer/);
        await expect(survey(cells, Number(foreign))).rejects.toThrow(/not an eligible waypoint/);
        await expect(survey(cells, ORIGIN, ORIGIN)).rejects.toThrow(/must be different/);
        await expect(survey(cells, Number(unrevealed))).resolves.toMatchObject({ fromIsVirgin: true });
    });
});

describe('RouteService.nextHops over Virgin ground', () => {
    it('refuses to route until the full map bootstrap is complete', async () => {
        const loading = makeService([own(String(ORIGIN))], DEFAULT_FLOORS, {}, false);

        await expect(loading.nextHops({ from: ORIGIN, towards: null, resourceId: RES })).rejects.toThrow(
            /map bootstrap/,
        );
    });

    it('refuses the same way on an incomplete snapshot before surveying the network', async () => {
        const loading = makeService([own(String(ORIGIN))], DEFAULT_FLOORS, {}, false);

        await expect(loading.network(exportInput())).rejects.toThrow(/map bootstrap/);
    });

    it('refuses on a map whose rows it could not all read, instead of reading the gap as Virgin ground', async () => {
        const unread = makeService([own(String(ORIGIN))], DEFAULT_FLOORS, {}, false, 1);

        await expect(unread.nextHops({ from: ORIGIN, towards: null, resourceId: RES })).rejects.toThrow(
            /could not read every row[\s\S]*Unreadable rows: 1/,
        );
        await expect(unread.nextHops({ from: ORIGIN, towards: null, resourceId: RES })).rejects.toThrow(
            /next whole-map read[\s\S]*update to a client that understands the rows this world serves/,
        );
        await expect(unread.network(exportInput())).rejects.toThrow(/could not read every row/);
    });

    it('names the unread row, not the missed update, when both went unread at once', async () => {
        const both = makeService([own(String(ORIGIN))], DEFAULT_FLOORS, {}, false, 1, 1);

        const failure = await both
            .nextHops({ from: ORIGIN, towards: null, resourceId: RES })
            .then(() => null)
            .catch((error: Error) => error.message);

        expect(failure).toMatch(/could not read every row[\s\S]*Unreadable rows: 1/);
        expect(failure).not.toMatch(/Unreadable updates/);
    });

    it('blames staleness, not an out-of-date client, when a live update was the thing it could not read', async () => {
        const stale = makeService([own(String(ORIGIN))], DEFAULT_FLOORS, {}, false, 0, 1);

        const failure = await stale
            .nextHops({ from: ORIGIN, towards: null, resourceId: RES })
            .then(() => null)
            .catch((error: Error) => error.message);

        expect(failure).toMatch(/Unreadable updates: 1/);
        expect(failure).toMatch(/next whole-map read/);
        expect(failure).not.toMatch(/update to a client/);
        await expect(stale.network(exportInput())).rejects.toThrow(/Unreadable updates: 1/);
    });

    it('treats a valid token id absent from a complete snapshot as unminted Virgin ground', async () => {
        const result = await survey([own(String(ORIGIN))], ORIGIN);

        expect(result.hops.map((h) => h.tokenId).sort()).toEqual(neighbors(ORIGIN).map(String).sort());
        expect(hopFor(result, at(1))).toMatchObject({
            isVirgin: true,
            isOwn: false,
            isHub: false,
            owner: null,
            ready: null,
            radius: 1,
            hopDistance: 1,
            transitFeePerUnit: null,
        });
    });

    it('keeps a minted cell with no completed reveal Virgin, a pending first reveal included', async () => {
        const mine = at(1, 0);
        const rivals = at(1, 1);
        const cells = [
            own(String(ORIGIN)),
            own(mine, { revealCount: 0 }),
            makeCell({ tokenId: rivals, owner: RIVAL, revealCount: 0, revealPending: true }),
        ];

        const result = await survey(cells, ORIGIN);

        expect(hopFor(result, mine)).toMatchObject({ isVirgin: true, isOwn: true, owner: WALLET_ADDRESS });
        expect(hopFor(result, rivals)).toMatchObject({ isVirgin: true, isOwn: false, owner: RIVAL });
        expect(settled(result)).toEqual([]);
    });

    it('never calls a waypoint free in the note while the same result bills a fee for it', async () => {
        const fee = '17';
        const standing = at(1);
        const cells = [own(String(ORIGIN)), foreignHub(standing, fee, BASE_HUB, { revealCount: 0 })];

        const result = await survey(cells, ORIGIN);
        const billed = result.hops.filter((h) => h.isVirgin && h.transitFeePerUnit !== null);

        expect(hopFor(result, standing)).toMatchObject({ isVirgin: true, isHub: true, transitFeePerUnit: fee });
        expect(billed).toHaveLength(1);
        expect(result.note).toMatch(/Hub standing on Virgin ground still charges/);
        expect(result.note).not.toMatch(/nobody controls it and it charges nothing/);
    });

    it('charges nothing for your own Hub on your own unrevealed cell, and says so in the note', async () => {
        const standing = at(1);
        const cells = [
            own(String(ORIGIN)),
            hub(standing, WALLET_ADDRESS, BASE_HUB, { revealCount: 0, transitFeeOverrides: { [RES]: '17' } }),
        ];

        const result = await survey(cells, ORIGIN);

        expect(hopFor(result, standing)).toMatchObject({
            isVirgin: true,
            isHub: true,
            isOwn: true,
            transitFeePerUnit: null,
        });
        expect(result.note).toMatch(/Hub of your own on it charges you nothing/);
    });

    it('surveys from a Virgin cell, since goods can stand on open ground mid-route', async () => {
        const standing = at(1);

        const result = await survey([own(String(ORIGIN))], Number(standing));

        expect(result.fromIsVirgin).toBe(true);
        expect(result.fromRadius).toBe(1);
        expect(settled(result)).toEqual([String(ORIGIN)]);
    });

    it('keeps own cells and foreign Active Hubs as Intermediate waypoints and drops a foreign revealed cell', async () => {
        const mine = at(1, 0);
        const controlled = at(1, 1);
        const hubCell = at(BASE_HUB_RADIUS);
        const cells = [
            own(String(ORIGIN)),
            own(mine),
            makeCell({ tokenId: controlled, owner: RIVAL, revealCount: 1 }),
            foreignHub(hubCell, '0.5'),
        ];

        const result = await survey(cells, ORIGIN);

        expect(settled(result)).toEqual([mine, hubCell]);
        expect(result.hops.map((h) => h.tokenId)).not.toContain(controlled);
        expect(hopFor(result, hubCell)).toMatchObject({ isVirgin: false, isHub: true, transitFeePerUnit: '0.5' });
    });

    it('excludes a foreign Hub still under construction while the same finished Hub is a waypoint', async () => {
        const spot = at(BASE_HUB_RADIUS + 1);
        const origin = hub(String(ORIGIN), WALLET_ADDRESS, MID_HUB);

        const finished = await survey([origin, foreignHub(spot, '0.5')], ORIGIN);
        const goingUp = await survey(
            [origin, foreignHub(spot, '0.5', BASE_HUB, withBuilding(BASE_HUB, UNFINISHED_AT))],
            ORIGIN,
        );

        expect(settled(finished)).toEqual([spot]);
        expect(goingUp.hops.map((h) => h.tokenId)).not.toContain(spot);
    });

    it('keeps an owned cell whose Hub is unfinished — under construction — on ordinary move reach', async () => {
        const goingUp = at(1);
        const cells = [
            own(String(ORIGIN)),
            own(goingUp, { ...withBuilding(MID_HUB, UNFINISHED_AT), transitFeeOverrides: { [RES]: '0.5' } }),
        ];

        const result = await survey(cells, ORIGIN);

        expect(hopFor(result, goingUp)).toMatchObject({
            isOwn: true,
            isHub: false,
            ready: false,
            radius: 1,
            transitFeePerUnit: null,
        });
    });

    it('emits exactly the candidates waypoint membership admits, so hops cannot drift from the rules', async () => {
        const controlled = at(3);
        const cells = [
            hub(String(ORIGIN), WALLET_ADDRESS, BASE_HUB),
            own(at(2)),
            makeCell({ tokenId: controlled, owner: RIVAL, revealCount: 1 }),
        ];

        const result = await survey(cells, ORIGIN);

        const eligible = [...kRing(ORIGIN, BASE_HUB_RADIUS)]
            .filter(([token, step]) => step > 0 && String(token) !== controlled)
            .map(([token]) => String(token))
            .sort();
        expect(result.hops.map((h) => h.tokenId).sort()).toEqual(eligible);
        for (const candidate of result.hops) {
            expect(candidate.isVirgin || candidate.isOwn || candidate.isHub).toBe(true);
        }
    });
});

describe('RouteService.network', () => {
    it('validates the request before it touches the map: distinct endpoints, whole units, a transportable resource', async () => {
        const service = makeService([own(String(ORIGIN)), own(at(2))]);

        await expect(service.network(exportInput({ towards: ORIGIN }))).rejects.toThrow(/must be different/);
        await expect(service.network(exportInput({ amount: '0' }))).rejects.toThrow(/positive integer/);
        await expect(service.network(exportInput({ resourceId: 999 }))).rejects.toThrow(
            /does not exist or is not transportable/,
        );
    });

    it('refuses an endpoint that is not a revealed cell of the payer, foreign Active Hub included', async () => {
        const hubCell = at(BASE_HUB_RADIUS);
        const cells = [own(String(ORIGIN)), own(at(2)), own(at(3), { revealCount: 0 }), foreignHub(hubCell, '0.5')];
        const service = makeService(cells);

        await expect(service.network(exportInput({ towards: Number(hubCell) }))).rejects.toThrow(/is not yours/);
        await expect(service.network(exportInput({ from: Number(hubCell) }))).rejects.toThrow(/is not yours/);
        await expect(service.network(exportInput({ towards: Number(at(3)) }))).rejects.toThrow(/no completed reveal/);
        await expect(service.network(exportInput({ towards: Number(at(4)) }))).rejects.toThrow(/no completed reveal/);
    });

    it('carries the whole request into the artifact and the cargo alone into the quote call', async () => {
        const result = await makeService([own(String(ORIGIN)), own(at(2))]).network(exportInput());
        const graph = graphOf(result);

        expect(result.snapshotVersion).toBe(SNAPSHOT_VERSION);
        expect(graph.schemaVersion).toBe(result.schemaVersion);
        expect(graph.request).toEqual({ from: String(ORIGIN), towards: at(2), resourceId: RES, amount: AMOUNT });
        expect(result.quoteTemplate.arguments).toEqual({ path: [], resourceId: RES, amount: AMOUNT });
    });

    it('makes open Virgin ground a node, so unminted land between two of your cells is no wall', async () => {
        const target = at(2);
        const between = at(1);
        const result = await makeService([own(String(ORIGIN)), own(target)]).network(exportInput());
        const graph = graphOf(result);

        expect(result.connected).toBe(true);
        expect(nodeOf(graph, between)).toMatchObject({ owner: null, isVirgin: true, isOwn: false, radius: 1 });
        expect(edgeOf(graph, String(ORIGIN), between)).toBe(true);
        expect(edgeOf(graph, between, target)).toBe(true);
    });

    it('keeps foreign Active Hubs and drops foreign land past its first reveal that carries none', async () => {
        const hubCell = at(BASE_HUB_RADIUS);
        const controlled = at(3);
        const cells = [
            own(String(ORIGIN)),
            own(at(2)),
            foreignHub(hubCell, '0.5'),
            makeCell({ tokenId: controlled, owner: RIVAL, revealCount: 1 }),
        ];

        const graph = graphOf(await makeService(cells).network(exportInput()));

        expect(nodeOf(graph, hubCell)).toMatchObject({ isHub: true, isOwn: false, transitFeePerUnit: '0.5' });
        expect(nodeOf(graph, controlled)).toBeNull();
        expect(edgeOf(graph, String(ORIGIN), hubCell)).toBe(true);
    });

    it('gives a foreign Hub still under construction neither its reach nor a node', async () => {
        const spot = at(BASE_HUB_RADIUS);
        const unfinished = foreignHub(spot, '0.5', BASE_HUB, withBuilding(BASE_HUB, UNFINISHED_AT));

        const graph = graphOf(await makeService([own(String(ORIGIN)), own(at(2)), unfinished]).network(exportInput()));

        expect(nodeOf(graph, spot)).toBeNull();
    });

    it('spans each Ready Hub tier with the radius that tier serves instead of one shared hub reach', async () => {
        const top = at(TOP_HUB_RADIUS);
        const mid = at(MID_HUB_RADIUS);
        const cells = (type: string): Array<RawCell> => [
            own(String(ORIGIN), withBuilding(type)),
            own(at(2)),
            own(top),
            own(mid),
        ];

        const upgraded = graphOf(await makeService(cells(TOP_HUB)).network(exportInput()));
        const base = graphOf(await makeService(cells(BASE_HUB)).network(exportInput()));

        expect(nodeOf(upgraded, String(ORIGIN))?.radius).toBe(TOP_HUB_RADIUS);
        expect(edgeOf(upgraded, String(ORIGIN), top)).toBe(true);
        expect(edgeOf(upgraded, String(ORIGIN), mid)).toBe(true);
        expect(nodeOf(base, String(ORIGIN))?.radius).toBe(BASE_HUB_RADIUS);
        expect(edgeOf(base, String(ORIGIN), top)).toBe(false);
        expect(edgeOf(base, String(ORIGIN), mid)).toBe(false);
    });

    it('follows a move radius that is not the launch value when it decides which hops are legal', async () => {
        const wide = await makeService([own(String(ORIGIN)), own(at(2))], DEFAULT_FLOORS, {
            moveRadius: 2,
        }).network(exportInput());
        const graph = graphOf(wide);

        expect(nodeOf(graph, String(ORIGIN))?.radius).toBe(2);
        expect(edgeOf(graph, String(ORIGIN), at(3))).toBe(true);
        expect(edgeOf(graph, String(ORIGIN), at(4))).toBe(false);
    });

    it('marks the graph disconnected and keeps both ends when a foreign belt seals one of them in', async () => {
        const sealed = neighbors(ORIGIN).map((token) =>
            makeCell({ tokenId: String(token), owner: RIVAL, revealCount: 1 }),
        );
        const target = farAway();

        const result = await makeService([own(String(ORIGIN)), own(target), ...sealed]).network(
            exportInput({ towards: Number(target) }),
        );
        const graph = graphOf(result);

        expect(result.connected).toBe(false);
        expect(graph.connected).toBe(false);
        expect(nodeOf(graph, String(ORIGIN))).not.toBeNull();
        expect(nodeOf(graph, target)).not.toBeNull();
        expect(graph.nodes).toHaveLength(MAX_TOKEN_ID - sealed.length);
    });

    it('reports the artifact counts it wrote without ever putting the graph in the answer', async () => {
        const result = await makeService([own(String(ORIGIN)), own(at(2))]).network(exportInput());
        const graph = graphOf(result);

        expect(result.nodeCount).toBe(graph.nodes.length);
        expect(result.edgeCount).toBe(graph.edges.length);
        expect(JSON.stringify(result)).not.toContain('"nodes"');
        expect(result.note).toMatch(/raw route graph/);
    });
});
