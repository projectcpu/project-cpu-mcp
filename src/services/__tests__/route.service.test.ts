import { describe, expect, it } from 'vitest';

import { DEFAULT_SERVER_TIME, FakeAppConfig, makeConfig, WALLET_ADDRESS } from './service-fakes.js';
import { BuildingKind, BuildingType } from '../../api/types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { makeCell } from '../../map/__tests__/fixtures.js';
import { toCell } from '../../map/cell-view.utils.js';
import { toProjectionConfig } from '../../map/reader.utils.js';
import type { RawCell } from '../../map/types.js';
import { formatUnixSeconds } from '../../utils/format.utils.js';
import type { WalletProvider } from '../../wallet/types.js';
import { RouteService } from '../route.service.js';
import type { CatalogBuildingView } from '../types.js';

const RIVAL = '0x000000000000000000000000000000000000beef';
const RES = 3;
const DEFAULT_FLOORS: Record<number, string> = { 3: '0', 9: '0' };
const UPGRADED_HUB = 'hub_l2a';
const UNFINISHED_AT = DEFAULT_SERVER_TIME + 1000;

function own(tokenId: string, over: Partial<RawCell> = {}): RawCell {
    return makeCell({ tokenId, owner: WALLET_ADDRESS, revealCount: 1, ...over });
}

function hub(tokenId: string, owner: string, over: Partial<RawCell> = {}): RawCell {
    return makeCell({
        tokenId,
        owner,
        revealCount: 1,
        building: { type: BuildingType.Hub, buildFinishAt: null, modeResource: null, modeRecipeId: null },
        ...over,
    });
}

function foreignHub(tokenId: string, feePerUnit: string, over: Partial<RawCell> = {}): RawCell {
    return hub(tokenId, RIVAL, { transitFeeOverrides: { [RES]: feePerUnit }, ...over });
}

function upgradedHubCatalogEntry(base: Array<CatalogBuildingView>): CatalogBuildingView {
    const entry = base.find((b) => b.kind === BuildingKind.Hub) as CatalogBuildingView;
    return { ...entry, type: UPGRADED_HUB as CatalogBuildingView['type'], onChainId: 99, name: 'Mega Hub', tier: 2 };
}

function makeService(cells: Array<RawCell>, moveFeeFloors: Record<number, string> = DEFAULT_FLOORS): RouteService {
    const wallet = { get: () => ({ getAddress: () => WALLET_ADDRESS }) } as unknown as WalletProvider;
    const base = makeConfig();
    const config = {
        ...base,
        transport: { ...base.transport, moveFeeFloors },
        buildings: [...base.buildings, upgradedHubCatalogEntry(base.buildings)],
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

describe('RouteService.nextHops', () => {
    it('lists own cells within cell reach and hubs within hub reach, with their facts', async () => {
        const cells = [own('72'), own('73'), own('76'), foreignHub('75', '0.5')];

        const result = await survey(cells, 72);

        expect(result.from).toBe('72');
        expect(result.fromIsHub).toBe(false);
        expect(result.reach).toEqual({ moveRadius: 1, hubRadius: 3 });
        expect(result.hops.map((h) => h.tokenId)).toEqual(['73', '75']);
        expect(result.hops[0]).toMatchObject({ tokenId: '73', hopDistance: 1, isOwn: true, transitFeePerUnit: null });
        expect(result.hops[1]).toMatchObject({
            tokenId: '75',
            hopDistance: 3,
            isHub: true,
            owner: RIVAL,
            transitFeePerUnit: '0.5',
        });
        expect(result.hops[1]?.pos).toEqual({ face: 0, i: 1, j: 5 });
    });

    it('resolves the transit fee for the requested resource: override for it, its floor otherwise', async () => {
        const cells = [own('72'), foreignHub('75', '0.5')];

        const forRes3 = await survey(cells, 72, null, 3);
        expect(forRes3.hops.find((h) => h.tokenId === '75')?.transitFeePerUnit).toBe('0.5');

        const forRes9 = await makeService(cells, { 3: '0', 9: '0.2' }).nextHops({
            from: 72,
            towards: null,
            resourceId: 9,
        });
        expect(forRes9.hops.find((h) => h.tokenId === '75')?.transitFeePerUnit).toBe('0.2');
    });

    it('rejects a resource id that has no floor row in the config before any route work', async () => {
        await expect(survey([own('72'), foreignHub('75', '0.5')], 72, null, 999)).rejects.toThrow(
            /does not exist or is not transportable/,
        );
    });

    it('adds a compass when towards is given and sorts by remaining distance', async () => {
        const cells = [own('72'), own('73'), own('78'), foreignHub('75', '0.5')];

        const result = await survey(cells, 72, 78);

        expect(result.targetDistance).toBe(6);
        expect(result.hops.map((h) => h.tokenId)).toEqual(['75', '73']);
        expect(result.hops[0]?.distanceToTarget).toBe(3);
        expect(result.hops[1]?.distanceToTarget).toBe(5);
    });

    it('returns an empty list when nothing is within reach — the agent decides what to do', async () => {
        const result = await survey([own('72'), own('78')], 72, 78);

        expect(result.hops).toEqual([]);
        expect(result.targetDistance).toBe(6);
    });

    it('reaches farther when surveying from a hub', async () => {
        const cells = [hub('72', WALLET_ADDRESS), own('75'), own('76')];

        const result = await survey(cells, 72);

        expect(result.fromIsHub).toBe(true);
        expect(result.fromReady).toBe(true);
        expect(result.hops.map((h) => h.tokenId)).toEqual(['75']);
        expect(result.hops[0]?.hopDistance).toBe(3);
    });

    it('skips a foreign hub that is still under construction — it is no waypoint yet', async () => {
        const unfinished = foreignHub('75', '0.5', {
            building: { type: BuildingType.Hub, buildFinishAt: UNFINISHED_AT, modeResource: null, modeRecipeId: null },
        });

        const result = await survey([own('72'), unfinished], 72);

        expect(result.hops).toEqual([]);
    });

    it('counts an upgraded finished hub the catalog names as a waypoint', async () => {
        const upgraded = foreignHub('75', '0.5', {
            building: { type: UPGRADED_HUB, buildFinishAt: null, modeResource: null, modeRecipeId: null },
        });

        const result = await survey([own('72'), upgraded], 72);

        expect(result.hops).toHaveLength(1);
        expect(result.hops[0]).toMatchObject({
            tokenId: '75',
            hopDistance: 3,
            isHub: true,
            ready: true,
            transitFeePerUnit: '0.5',
        });
    });

    it('keeps an owned cell whose hub is still going up as an origin, with normal reach and no hub bonus', async () => {
        const building = {
            type: BuildingType.Hub,
            buildFinishAt: UNFINISHED_AT,
            modeResource: null,
            modeRecipeId: null,
        };
        const cells = [own('72', { building, transitFeeOverrides: { [RES]: '0.5' } }), own('73'), own('75')];

        const result = await survey(cells, 72);

        expect(result.fromIsHub).toBe(false);
        expect(result.fromReady).toBe(false);
        expect(result.hops.map((h) => h.tokenId)).toEqual(['73']);
    });

    it('reports a bare waypoint as ready: null rather than not-ready', async () => {
        const result = await survey([own('72'), own('73')], 72);

        expect(result.fromReady).toBeNull();
        expect(result.hops[0]?.ready).toBeNull();
    });

    it('rejects routing from a hub still under construction, naming when it will be ready', async () => {
        const unfinished = foreignHub('75', '0.5', {
            building: { type: BuildingType.Hub, buildFinishAt: UNFINISHED_AT, modeResource: null, modeRecipeId: null },
        });

        await expect(survey([own('72'), unfinished], 75)).rejects.toThrow(
            `The Hub on cell 75 is still under construction (ready ${formatUnixSeconds(UNFINISHED_AT)}); ` +
                'it counts as a waypoint only once construction finishes.',
        );
    });

    it('rejects ineligible or unknown origins with specific errors', async () => {
        const cells = [
            own('72'),
            makeCell({ tokenId: '73', owner: RIVAL, revealCount: 1 }),
            own('74', { revealCount: 0 }),
        ];

        await expect(survey(cells, 99)).rejects.toThrow(/not in the current map/);
        await expect(survey(cells, 73)).rejects.toThrow(/not an eligible waypoint/);
        await expect(survey(cells, 74)).rejects.toThrow(/not revealed/);
        await expect(survey(cells, 72, 72)).rejects.toThrow(/must be different/);
    });
});

describe('RouteService.network', () => {
    it('returns nodes with facts, legal edges and component labels', async () => {
        const cells = [own('72'), own('73'), foreignHub('75', '0.5'), own('220'), own('221')];

        const result = await makeService(cells).network({ from: null, towards: null, resourceId: RES });

        expect(result.nodes.map((n) => n.tokenId)).toEqual(['72', '73', '75', '220', '221']);
        expect(result.edges).toEqual([
            { a: '72', b: '73', distance: 1 },
            { a: '72', b: '75', distance: 3 },
            { a: '73', b: '75', distance: 2 },
            { a: '220', b: '221', distance: 1 },
        ]);
        expect(result.components).toBe(2);
        const byToken = new Map(result.nodes.map((n) => [n.tokenId, n]));
        expect(byToken.get('72')?.component).toBe(byToken.get('75')?.component);
        expect(byToken.get('220')?.component).not.toBe(byToken.get('72')?.component);
        expect(byToken.get('75')).toMatchObject({ isHub: true, transitFeePerUnit: '0.5', owner: RIVAL });
        expect(byToken.get('73')?.pos).toEqual({ face: 0, i: 1, j: 3 });
    });

    it('annotates distance fields when from/towards are given', async () => {
        const cells = [own('72'), own('73'), foreignHub('75', '0.5'), own('78')];

        const result = await makeService(cells).network({ from: 72, towards: 78, resourceId: RES });

        expect(result.fromToTarget).toBe(6);
        const byToken = new Map(result.nodes.map((n) => [n.tokenId, n]));
        expect(byToken.get('75')).toMatchObject({ distFromSource: 3, distToTarget: 3 });
        expect(byToken.get('73')).toMatchObject({ distFromSource: 1, distToTarget: 5 });
        expect(byToken.get('72')).toMatchObject({ distFromSource: 0, distToTarget: 6 });
    });

    it('a single foreign cell between plain cells is a wall; a hub reaches across', async () => {
        const rival = makeCell({ tokenId: '73', owner: RIVAL, revealCount: 1 });

        const walled = await makeService([own('72'), rival, own('74')]).network({
            from: null,
            towards: null,
            resourceId: RES,
        });
        expect(walled.nodes.map((n) => n.tokenId)).toEqual(['72', '74']);
        expect(walled.edges).toEqual([]);
        expect(walled.components).toBe(2);

        const bridged = await makeService([hub('72', WALLET_ADDRESS), rival, own('74')]).network({
            from: null,
            towards: null,
            resourceId: RES,
        });
        expect(bridged.edges).toEqual([{ a: '72', b: '74', distance: 2 }]);
        expect(bridged.components).toBe(1);
    });

    it('drops a foreign hub that is still under construction from the network', async () => {
        const unfinished = foreignHub('75', '0.5', {
            building: { type: BuildingType.Hub, buildFinishAt: UNFINISHED_AT, modeResource: null, modeRecipeId: null },
        });

        const result = await makeService([own('72'), unfinished]).network({
            from: null,
            towards: null,
            resourceId: RES,
        });

        expect(result.nodes.map((n) => n.tokenId)).toEqual(['72']);
    });

    it('an upgraded finished hub is a node and bridges a wall', async () => {
        const rival = makeCell({ tokenId: '73', owner: RIVAL, revealCount: 1 });
        const upgraded = own('72', {
            building: { type: UPGRADED_HUB, buildFinishAt: null, modeResource: null, modeRecipeId: null },
        });

        const result = await makeService([upgraded, rival, own('74')]).network({
            from: null,
            towards: null,
            resourceId: RES,
        });

        expect(result.nodes.find((n) => n.tokenId === '72')).toMatchObject({ isHub: true, ready: true });
        expect(result.edges).toEqual([{ a: '72', b: '74', distance: 2 }]);
    });

    it('an owned cell whose hub is unfinished stays a node with normal reach and no transit fee', async () => {
        const rival = makeCell({ tokenId: '73', owner: RIVAL, revealCount: 1 });
        const building = {
            type: BuildingType.Hub,
            buildFinishAt: UNFINISHED_AT,
            modeResource: null,
            modeRecipeId: null,
        };
        const goingUp = own('72', { building, transitFeeOverrides: { [RES]: '0.5' } });

        const result = await makeService([goingUp, rival, own('74')]).network({
            from: null,
            towards: null,
            resourceId: RES,
        });

        expect(result.nodes.find((n) => n.tokenId === '72')).toMatchObject({
            isHub: false,
            ready: false,
            transitFeePerUnit: null,
        });
        expect(result.edges).toEqual([]);
    });

    it('rejects a resource id with no floor row before surveying the network', async () => {
        await expect(
            makeService([own('72'), foreignHub('75', '0.5')]).network({ from: null, towards: null, resourceId: 999 }),
        ).rejects.toThrow(/does not exist or is not transportable/);
    });

    it('shows a disconnected target as a separate component', async () => {
        const cells = [own('72'), own('73'), own('220')];

        const result = await makeService(cells).network({ from: 72, towards: 220, resourceId: RES });

        const byToken = new Map(result.nodes.map((n) => [n.tokenId, n]));
        expect(byToken.get('72')?.component).not.toBe(byToken.get('220')?.component);
        expect(result.fromToTarget).toBeGreaterThan(0);
    });
});
