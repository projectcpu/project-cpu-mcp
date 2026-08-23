import { describe, expect, it } from 'vitest';

import { DEFAULT_SERVER_TIME, FakeAppConfig, makeConfig, WALLET_ADDRESS } from './service-fakes.js';
import { BuildingKind, BuildingType, type TransportRoutingView } from '../../api/types.js';
import { neighbors } from '../../geometry/adjacency.js';
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
import type { CatalogBuildingView, NetworkEdgeView } from '../types.js';

const RIVAL = '0x000000000000000000000000000000000000beef';
const RES = 3;
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

function makeService(
    cells: Array<RawCell>,
    moveFeeFloors: Record<number, string> = DEFAULT_FLOORS,
    transport: Partial<TransportRoutingView> = {},
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
        mapReader: { allCells: async () => cells.map((c) => toCell(c, DEFAULT_SERVER_TIME, projection)) },
        logger: new NoopLogger(),
    });
}

function survey(cells: Array<RawCell>, from: number, towards: number | null = null, resourceId = RES) {
    return makeService(cells).nextHops({ from, towards, resourceId });
}

function edgeKeys(edges: Array<NetworkEdgeView>): Array<string> {
    return edges.map((edge) => `${edge.a}-${edge.b}:${edge.distance}`).sort();
}

function expectedEdge(a: string, b: string): string {
    const [low, high] = Number(a) < Number(b) ? [a, b] : [b, a];
    return `${low}-${high}:${gridDistance(a, b)}`;
}

describe('RouteService.nextHops', () => {
    it('lists own cells within move reach and hubs within their own reach, with their facts', async () => {
        const neighbour = at(1);
        const hubCell = at(BASE_HUB_RADIUS);
        const cells = [own(String(ORIGIN)), own(neighbour), own(at(2)), foreignHub(hubCell, '0.5')];

        const result = await survey(cells, ORIGIN);

        expect(result.from).toBe(String(ORIGIN));
        expect(result.fromIsHub).toBe(false);
        expect(result.fromRadius).toBe(1);
        expect(result.reach).toEqual({ moveRadius: 1 });
        expect(result.hops.map((h) => h.tokenId)).toEqual([neighbour, hubCell]);
        expect(result.hops[0]).toMatchObject({
            tokenId: neighbour,
            hopDistance: 1,
            isOwn: true,
            radius: 1,
            transitFeePerUnit: null,
        });
        expect(result.hops[1]).toMatchObject({
            tokenId: hubCell,
            hopDistance: BASE_HUB_RADIUS,
            isHub: true,
            radius: BASE_HUB_RADIUS,
            owner: RIVAL,
            transitFeePerUnit: '0.5',
        });
        expect(result.hops[1]?.pos).toEqual(tokenIdToPos(hubCell));
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

    it('returns an empty list when nothing is within reach — the agent decides what to do', async () => {
        const target = farAway();
        const result = await survey([own(String(ORIGIN)), own(target)], ORIGIN, Number(target));

        expect(result.hops).toEqual([]);
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
        expect(result.hops.map((h) => h.tokenId)).toEqual([inReach]);
        expect(result.hops[0]?.hopDistance).toBe(BASE_HUB_RADIUS);
    });

    it('reaches a ready hub upgrade with the radius that upgrade carries, not the base hub radius', async () => {
        const beyondBase = at(MID_HUB_RADIUS);
        const upgraded = foreignHub(beyondBase, '0.5', MID_HUB);
        const base = foreignHub(beyondBase, '0.5', BASE_HUB);

        const withUpgrade = await survey([own(String(ORIGIN)), upgraded], ORIGIN);
        const withBase = await survey([own(String(ORIGIN)), base], ORIGIN);

        expect(withUpgrade.hops.map((h) => h.tokenId)).toEqual([beyondBase]);
        expect(withUpgrade.hops[0]).toMatchObject({
            hopDistance: MID_HUB_RADIUS,
            radius: MID_HUB_RADIUS,
            isHub: true,
            ready: true,
            transitFeePerUnit: '0.5',
        });
        expect(withBase.hops).toEqual([]);
    });

    it('keeps every rung of the hub ladder apart instead of granting one shared hub reach', async () => {
        const topOnly = at(TOP_HUB_RADIUS);

        const top = await survey([own(String(ORIGIN)), foreignHub(topOnly, '0.5', TOP_HUB)], ORIGIN);
        const mid = await survey([own(String(ORIGIN)), foreignHub(topOnly, '0.5', MID_HUB)], ORIGIN);

        expect(top.hops.map((h) => h.radius)).toEqual([TOP_HUB_RADIUS]);
        expect(mid.hops).toEqual([]);
    });

    it('holds the two-endpoint reach rule exactly at the limit and one step beyond it', async () => {
        const origin = hub(String(ORIGIN), WALLET_ADDRESS, MID_HUB);
        const limit = MID_HUB_RADIUS + BASE_HUB_RADIUS - 1;
        const atLimit = at(limit);
        const beyondLimit = at(limit + 1);

        const result = await survey([origin, foreignHub(atLimit, '0.5'), foreignHub(beyondLimit, '0.5')], ORIGIN);

        expect(result.hops.map((h) => h.tokenId)).toEqual([atLimit]);
        expect(result.hops[0]?.hopDistance).toBe(limit);
    });

    it('follows a move radius that is not the launch value', async () => {
        const cells = [own(String(ORIGIN)), own(at(3)), own(at(4))];

        const result = await makeService(cells, DEFAULT_FLOORS, { moveRadius: 2 }).nextHops({
            from: ORIGIN,
            towards: null,
            resourceId: RES,
        });

        expect(result.fromRadius).toBe(2);
        expect(result.reach).toEqual({ moveRadius: 2 });
        expect(result.hops.map((h) => h.tokenId)).toEqual([at(3)]);
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

        expect(result.hops).toEqual([]);
    });

    it('denies a hub upgrade under construction both its reach and its fee until it is ready', async () => {
        const spot = at(MID_HUB_RADIUS);
        const goingUp = own(spot, { ...withBuilding(MID_HUB, UNFINISHED_AT), transitFeeOverrides: { [RES]: '0.5' } });

        const unfinished = await survey([own(String(ORIGIN)), goingUp], ORIGIN);
        expect(unfinished.hops).toEqual([]);

        const finished = await survey(
            [own(String(ORIGIN)), own(spot, { ...withBuilding(MID_HUB), transitFeeOverrides: { [RES]: '0.5' } })],
            ORIGIN,
        );
        expect(finished.hops.map((h) => h.radius)).toEqual([MID_HUB_RADIUS]);
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
        expect(result.hops.map((h) => h.tokenId)).toEqual([neighbour]);
    });

    it('states the reach rule as the two-endpoint sum instead of one universal hub reach', async () => {
        const result = await survey([own(String(ORIGIN)), own(at(1))], ORIGIN);

        expect(result.note).toContain('radius(from)+radius(to)−1');
        expect(result.note).toMatch(/its own tier serves/);
    });

    it('reports a bare waypoint as ready: null rather than not-ready', async () => {
        const result = await survey([own(String(ORIGIN)), own(at(1))], ORIGIN);

        expect(result.fromReady).toBeNull();
        expect(result.hops[0]?.ready).toBeNull();
    });

    it('rejects routing from a hub still under construction, naming when it will be ready', async () => {
        const spot = at(BASE_HUB_RADIUS);
        const unfinished = foreignHub(spot, '0.5', BASE_HUB, withBuilding(BASE_HUB, UNFINISHED_AT));

        await expect(survey([own(String(ORIGIN)), unfinished], Number(spot))).rejects.toThrow(
            `The Hub reaching ${BASE_HUB_RADIUS} on cell ${spot} is still under construction (ready ` +
                `${formatUnixSeconds(UNFINISHED_AT)}); it counts as a waypoint only once construction finishes.`,
        );
    });

    it('rejects ineligible or unknown origins with specific errors', async () => {
        const foreign = at(1);
        const unrevealed = at(2);
        const cells = [
            own(String(ORIGIN)),
            makeCell({ tokenId: foreign, owner: RIVAL, revealCount: 1 }),
            own(unrevealed, { revealCount: 0 }),
        ];

        await expect(survey(cells, Number(farAway()))).rejects.toThrow(/not in the current map/);
        await expect(survey(cells, Number(foreign))).rejects.toThrow(/not an eligible waypoint/);
        await expect(survey(cells, Number(unrevealed))).rejects.toThrow(/not revealed/);
        await expect(survey(cells, ORIGIN, ORIGIN)).rejects.toThrow(/must be different/);
    });
});

describe('RouteService.network', () => {
    it('returns nodes with facts, legal edges and component labels', async () => {
        const neighbour = at(1);
        const hubCell = at(BASE_HUB_RADIUS);
        const distant = farAway();
        const distantNeighbour = String(neighbors(Number(distant))[0]);
        const cells = [
            own(String(ORIGIN)),
            own(neighbour),
            foreignHub(hubCell, '0.5'),
            own(distant),
            own(distantNeighbour),
        ];

        const result = await makeService(cells).network({ from: null, towards: null, resourceId: RES });

        expect(new Set(result.nodes.map((n) => n.tokenId))).toEqual(
            new Set([String(ORIGIN), neighbour, hubCell, distant, distantNeighbour]),
        );
        expect(edgeKeys(result.edges)).toEqual(
            [
                expectedEdge(String(ORIGIN), neighbour),
                expectedEdge(String(ORIGIN), hubCell),
                expectedEdge(neighbour, hubCell),
                expectedEdge(distant, distantNeighbour),
            ].sort(),
        );
        expect(result.components).toBe(2);
        const byToken = new Map(result.nodes.map((n) => [n.tokenId, n]));
        expect(byToken.get(String(ORIGIN))?.component).toBe(byToken.get(hubCell)?.component);
        expect(byToken.get(distant)?.component).not.toBe(byToken.get(String(ORIGIN))?.component);
        expect(byToken.get(hubCell)).toMatchObject({ isHub: true, transitFeePerUnit: '0.5', owner: RIVAL });
        expect(byToken.get(neighbour)?.pos).toEqual(tokenIdToPos(neighbour));
    });

    it('annotates distance fields when from/towards are given', async () => {
        const neighbour = at(1);
        const hubCell = at(BASE_HUB_RADIUS);
        const target = at(BASE_HUB_RADIUS + 1);
        const cells = [own(String(ORIGIN)), own(neighbour), foreignHub(hubCell, '0.5'), own(target)];

        const result = await makeService(cells).network({ from: ORIGIN, towards: Number(target), resourceId: RES });

        expect(result.fromToTarget).toBe(gridDistance(String(ORIGIN), target));
        const byToken = new Map(result.nodes.map((n) => [n.tokenId, n]));
        expect(byToken.get(hubCell)).toMatchObject({
            distFromSource: gridDistance(String(ORIGIN), hubCell),
            distToTarget: gridDistance(hubCell, target),
        });
        expect(byToken.get(String(ORIGIN))).toMatchObject({ distFromSource: 0 });
    });

    it('a foreign belt between plain cells is a wall; a hub reaches across', async () => {
        const between = at(1);
        const far = at(2);
        const rival = makeCell({ tokenId: between, owner: RIVAL, revealCount: 1 });

        const walled = await makeService([own(String(ORIGIN)), rival, own(far)]).network({
            from: null,
            towards: null,
            resourceId: RES,
        });
        expect(new Set(walled.nodes.map((n) => n.tokenId))).toEqual(new Set([String(ORIGIN), far]));
        expect(walled.edges).toEqual([]);
        expect(walled.components).toBe(2);

        const bridged = await makeService([hub(String(ORIGIN), WALLET_ADDRESS), rival, own(far)]).network({
            from: null,
            towards: null,
            resourceId: RES,
        });
        expect(edgeKeys(bridged.edges)).toEqual([expectedEdge(String(ORIGIN), far)]);
        expect(bridged.components).toBe(1);
    });

    it('drops a foreign hub that is still under construction from the network', async () => {
        const unfinished = foreignHub(at(BASE_HUB_RADIUS), '0.5', BASE_HUB, withBuilding(BASE_HUB, UNFINISHED_AT));

        const result = await makeService([own(String(ORIGIN)), unfinished]).network({
            from: null,
            towards: null,
            resourceId: RES,
        });

        expect(result.nodes.map((n) => n.tokenId)).toEqual([String(ORIGIN)]);
    });

    it('a ready hub upgrade spans an edge the base hub radius could not', async () => {
        const landing = at(MID_HUB_RADIUS);
        const upgraded = own(String(ORIGIN), withBuilding(MID_HUB));

        const result = await makeService([upgraded, own(landing)]).network({
            from: null,
            towards: null,
            resourceId: RES,
        });

        expect(result.nodes.find((n) => n.tokenId === String(ORIGIN))).toMatchObject({ isHub: true, ready: true });
        expect(edgeKeys(result.edges)).toEqual([expectedEdge(String(ORIGIN), landing)]);
    });

    it('an owned cell whose hub is unfinished stays a node with normal reach and no transit fee', async () => {
        const landing = at(BASE_HUB_RADIUS);
        const goingUp = own(String(ORIGIN), {
            ...withBuilding(BASE_HUB, UNFINISHED_AT),
            transitFeeOverrides: { [RES]: '0.5' },
        });

        const result = await makeService([goingUp, own(landing)]).network({
            from: null,
            towards: null,
            resourceId: RES,
        });

        expect(result.nodes.find((n) => n.tokenId === String(ORIGIN))).toMatchObject({
            isHub: false,
            ready: false,
            transitFeePerUnit: null,
        });
        expect(result.edges).toEqual([]);
    });

    it('rejects a resource id with no floor row before surveying the network', async () => {
        await expect(
            makeService([own(String(ORIGIN)), foreignHub(at(3), '0.5')]).network({
                from: null,
                towards: null,
                resourceId: 999,
            }),
        ).rejects.toThrow(/does not exist or is not transportable/);
    });

    it('shows a disconnected target as a separate component', async () => {
        const distant = farAway();
        const cells = [own(String(ORIGIN)), own(at(1)), own(distant)];

        const result = await makeService(cells).network({ from: ORIGIN, towards: Number(distant), resourceId: RES });

        const byToken = new Map(result.nodes.map((n) => [n.tokenId, n]));
        expect(byToken.get(String(ORIGIN))?.component).not.toBe(byToken.get(distant)?.component);
        expect(result.fromToTarget).toBeGreaterThan(0);
    });
});
