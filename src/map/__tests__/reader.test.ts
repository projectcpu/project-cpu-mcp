import { describe, expect, it } from 'vitest';

import { BuildingType } from '../../api/types.js';
import { FakeAppConfig, makeConfig } from '../../services/__tests__/service-fakes.js';
import { MapReader } from '../reader.js';
import { MapStore } from '../store.js';
import { MapReadiness, MapScope, type MapStatus, type RawCell } from '../types.js';
import { makeCell, makeMiningProcess, makeResource, makeSnapshot, makeStorage } from './fixtures.js';

const SNAPSHOT_SERVER_TIME = 1000;

function status(readiness: MapReadiness = MapReadiness.Ready, connected = true): MapStatus {
    return { getReadiness: () => readiness, isSocketConnected: () => connected, resyncNow: () => Promise.resolve() };
}

function makeReader(
    cells: Array<RawCell>,
    st: MapStatus = status(),
    store: MapStore = new MapStore(),
): { reader: MapReader; store: MapStore } {
    store.applySnapshot(makeSnapshot({ version: 50, serverTime: SNAPSHOT_SERVER_TIME, cells }));
    return { reader: new MapReader({ store, status: st, appConfig: new FakeAppConfig(makeConfig()) }), store };
}

function hubCell(tokenId: string, owner: string, buildFinishAt: number | null): RawCell {
    return makeCell({
        tokenId,
        owner,
        updated: 50,
        revealCount: 1,
        building: { type: BuildingType.Hub, buildFinishAt, modeResource: null, modeRecipeId: null },
        resources: [makeResource({ resourceId: 1, deposit: '1000', storage: makeStorage({ used: '0', cap: '100' }) })],
    });
}

describe('MapReader', () => {
    it('filters to owned cells with a resource index and a neighbour graph', async () => {
        const { reader } = makeReader([
            makeCell({
                tokenId: '72',
                owner: '0xme',
                updated: 50,
                resources: [{ resourceId: 1, deposit: '10', balance: '0', strength: null, storage: null }],
            }),
            makeCell({ tokenId: '73', owner: '0xrival', updated: 40 }),
        ]);

        const result = await reader.query({
            scope: MapScope.Mine,
            tokenIds: null,
            around: null,
            ownerAddress: '0xme',
        });

        expect(result.cells.map((c) => c.tokenId)).toEqual(['72']);
        expect(result.resourceIndex?.['1']).toHaveLength(1);
        expect(result.cells[0]?.neighbors).toHaveLength(6);
        expect(result.cells[0]?.pos).toEqual({ face: 0, i: 1, j: 2 });
        expect(result.summary.myCells).toBe(1);
    });

    it('returns a summary with no cells for scope=summary', async () => {
        const { reader } = makeReader([makeCell({ tokenId: '1', owner: '0xme', updated: 50 })]);

        const result = await reader.query({
            scope: MapScope.Summary,
            tokenIds: null,
            around: null,
            ownerAddress: '0xme',
        });

        expect(result.cells).toHaveLength(0);
        expect(result.resourceIndex).not.toBeNull();
        expect(result.summary.totalCells).toBe(1);
    });

    it('flags a still-loading map in the note', async () => {
        const { reader } = makeReader([makeCell({ tokenId: '1', updated: 50 })], status(MapReadiness.Loading));

        const result = await reader.query({ scope: MapScope.All, tokenIds: null, around: null, ownerAddress: null });

        expect(result.note).toMatch(/loading/i);
    });

    it('inspects a cell with expanded neighbours and distance from owned cells', async () => {
        const { reader } = makeReader([
            makeCell({ tokenId: '72', owner: '0xrival', updated: 50 }),
            makeCell({ tokenId: '73', owner: '0xme', updated: 50 }),
        ]);

        const inspection = await reader.inspectCell('72', '0xme');

        expect(inspection?.distanceFromMine).toBe(1);
        expect(inspection?.neighbors.map((c) => c.tokenId)).toContain('73');
        expect(await reader.inspectCell('missing', '0xme')).toBeNull();
    });

    it('reports null distanceFromMine when no owned cell is within the scan cap', async () => {
        const { reader } = makeReader([
            makeCell({ tokenId: '72', owner: '0xrival', updated: 50 }),
            makeCell({ tokenId: '25000', owner: '0xme', updated: 50 }),
        ]);

        expect((await reader.inspectCell('72', '0xme'))?.distanceFromMine).toBeNull();
        expect((await reader.inspectCell('72', null))?.distanceFromMine).toBeNull();
    });

    it('returns only cells newer than the version for getChanges', async () => {
        const { reader, store } = makeReader([makeCell({ tokenId: '1', updated: 50 })]);
        store.applyCell(makeCell({ tokenId: '2', updated: 120 }));

        const changes = await reader.getChanges(50, null);

        expect(changes.changed.map((c) => c.tokenId)).toEqual(['2']);
        expect(changes.version).toBe(120);
    });

    it('reads a reveal cell by tokenId and returns null when absent', async () => {
        const { reader } = makeReader([makeCell({ tokenId: '7', revealCount: 3, updated: 50 })]);

        expect(await reader.readRevealCell('7')).toMatchObject({ tokenId: '7', revealCount: 3 });
        expect(await reader.readRevealCell('missing')).toBeNull();
    });

    it('delegates refresh to the map status resync', async () => {
        let resyncs = 0;
        const st: MapStatus = {
            getReadiness: () => MapReadiness.Ready,
            isSocketConnected: () => true,
            resyncNow: async () => {
                resyncs += 1;
            },
        };
        const { reader } = makeReader([makeCell({ tokenId: '1', updated: 50 })], st);

        await reader.refresh();

        expect(resyncs).toBe(1);
    });
});

describe('MapReader projection', () => {
    it('multiplies the storage cap of a cell carrying an active hub', async () => {
        const { reader } = makeReader([hubCell('72', '0xme', 500)]);

        const cell = await reader.readRevealCell('72');

        expect(cell?.activeHub).toBe(true);
        expect(cell?.ready).toBe(true);
        expect(cell?.resources[0]?.storage?.cap).toBe('1000');
    });

    it('leaves the cap at base and the hub inactive while it is still under construction', async () => {
        const { reader } = makeReader([hubCell('72', '0xme', 5000)]);

        const cell = await reader.readRevealCell('72');

        expect(cell?.activeHub).toBe(false);
        expect(cell?.ready).toBe(false);
        expect(cell?.resources[0]?.storage?.cap).toBe('100');
    });

    it('reports ready as null for a cell with no building at all', async () => {
        const { reader } = makeReader([makeCell({ tokenId: '72', owner: '0xme', updated: 50 })]);

        const cell = await reader.readRevealCell('72');

        expect(cell?.ready).toBeNull();
        expect(cell?.activeHub).toBe(false);
    });

    it('projects the neighbours of an inspected cell, so one cell cannot report two caps in one response', async () => {
        const { reader } = makeReader([hubCell('72', '0xme', 500), hubCell('73', '0xrival', 500)]);

        const inspection = await reader.inspectCell('72', '0xme');
        const neighbor = inspection?.neighbors.find((c) => c.tokenId === '73');
        const direct = await reader.readRevealCell('73');

        expect(neighbor?.activeHub).toBe(true);
        expect(neighbor?.resources[0]?.storage?.cap).toBe('1000');
        expect(neighbor?.resources[0]?.storage?.cap).toBe(direct?.resources[0]?.storage?.cap);
    });

    it('counts a summary stall against the cap the projection derived', async () => {
        const { reader } = makeReader([
            makeCell({
                tokenId: '72',
                owner: '0xme',
                updated: 50,
                revealCount: 1,
                building: { type: BuildingType.Mine, buildFinishAt: 500, modeResource: null, modeRecipeId: null },
                process: makeMiningProcess({ resource: 1 }),
                resources: [
                    makeResource({ resourceId: 1, deposit: '1000', storage: makeStorage({ used: '100', cap: '100' }) }),
                ],
            }),
        ]);

        const result = await reader.query({
            scope: MapScope.Mine,
            tokenIds: null,
            around: null,
            ownerAddress: '0xme',
        });

        expect(result.summary.stalledCells).toBe(1);
        expect(result.cells[0]?.process?.stalled).toBe(true);
    });

    it('flips a hub from inactive to active as the clock crosses buildFinishAt, against the same snapshot with no re-fetch', async () => {
        let now = SNAPSHOT_SERVER_TIME;
        const store = new MapStore(() => now);
        const { reader } = makeReader([hubCell('72', '0xme', 2000)], status(), store);

        const before = await reader.readRevealCell('72');
        expect(before?.ready).toBe(false);
        expect(before?.activeHub).toBe(false);
        expect(before?.resources[0]?.storage?.cap).toBe('100');

        now = 2000;

        const after = await reader.readRevealCell('72');
        expect(after?.ready).toBe(true);
        expect(after?.activeHub).toBe(true);
        expect(after?.resources[0]?.storage?.cap).toBe('1000');
    });
});
