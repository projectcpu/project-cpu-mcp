import { describe, expect, it } from 'vitest';

import { makeCell, makeMiningProcess, makeCraftProcess, makeResource, makeStorage, projectCell } from './fixtures.js';
import {
    buildResourceIndex,
    classifyNeighbors,
    filterCells,
    isNewer,
    parseCell,
    parseSnapshot,
    summarizeMap,
} from '../map.utils.js';
import { MapReadiness, MapScope, type MapQuery, NeighborRelation, type RawCell } from '../types.js';

function query(overrides: Partial<MapQuery>): MapQuery {
    return { scope: MapScope.All, tokenIds: null, around: null, ownerAddress: null, ...overrides };
}

describe('parseSnapshot', () => {
    it('keeps valid cells and drops schema-invalid ones without failing the whole snapshot', () => {
        const raw = { serverTime: 1000, version: 5, cells: [makeCell({ tokenId: '1' }), { tokenId: 42 }] };
        const { snapshot, dropped } = parseSnapshot(raw);
        expect(snapshot.serverTime).toBe(1000);
        expect(snapshot.version).toBe(5);
        expect(snapshot.cells.map((c) => c.tokenId)).toEqual(['1']);
        expect(dropped).toBe(1);
    });

    it('tolerates stray extra fields on a cell (transitional server payloads)', () => {
        const raw = { serverTime: 1, version: 1, cells: [{ ...makeCell({ tokenId: '7' }), x: 3, y: -2 }] };
        const { snapshot, dropped } = parseSnapshot(raw);
        expect(snapshot.cells.map((c) => c.tokenId)).toEqual(['7']);
        expect(dropped).toBe(0);
    });

    it('throws on a malformed envelope (a real protocol error, not a stray cell)', () => {
        expect(() => parseSnapshot({ version: 1 })).toThrow();
    });

    it('keeps a cell carrying an upgraded building type instead of dropping it', () => {
        const upgraded = makeCell({
            tokenId: '9',
            building: { type: 'hub_l2a', buildFinishAt: null, modeResource: null, modeRecipeId: null },
        });
        const { snapshot, dropped } = parseSnapshot({ serverTime: 1, version: 1, cells: [upgraded] });
        expect(snapshot.cells.map((c) => c.tokenId)).toEqual(['9']);
        expect(dropped).toBe(0);
    });
});

describe('isNewer', () => {
    it('is true when nothing is held', () => {
        expect(isNewer(makeCell({ updated: 1 }), null)).toBe(true);
    });

    it('is true only for a strictly greater updated', () => {
        const held = makeCell({ updated: 100 });
        expect(isNewer(makeCell({ updated: 101 }), held)).toBe(true);
        expect(isNewer(makeCell({ updated: 100 }), held)).toBe(false);
        expect(isNewer(makeCell({ updated: 99 }), held)).toBe(false);
    });
});

describe('parseCell', () => {
    it('returns the cell for a valid payload', () => {
        expect(parseCell(makeCell())).not.toBeNull();
    });

    it('returns null for invalid payloads', () => {
        expect(parseCell({})).toBeNull();
        expect(parseCell(makeCell({ updated: 'soon' as unknown as number }))).toBeNull();
    });

    it('keeps a cell whose building is an upgraded type the client never enumerates', () => {
        const upgraded = makeCell({
            tokenId: '9',
            building: { type: 'oil_power_plant_l2a', buildFinishAt: null, modeResource: null, modeRecipeId: null },
        });
        expect(parseCell(upgraded)).not.toBeNull();
    });
});

describe('classifyNeighbors', () => {
    it('labels each grid neighbour owned / other / empty (case-insensitive owner)', () => {
        const grid = new Map<string, RawCell>([
            ['71', makeCell({ tokenId: '71', owner: '0xME' })],
            ['73', makeCell({ tokenId: '73', owner: '0xrival' })],
        ]);
        const getByTokenId = (tokenId: string): RawCell | null => grid.get(tokenId) ?? null;

        const refs = classifyNeighbors(makeCell({ tokenId: '72' }), getByTokenId, '0xme');

        expect(refs).toHaveLength(6);
        expect(refs.map((r) => r.tokenId).sort((a, b) => Number(a) - Number(b))).toEqual([
            '1',
            '2',
            '71',
            '73',
            '142',
            '143',
        ]);
        expect(refs.filter((r) => r.relation === NeighborRelation.Owned).map((r) => r.tokenId)).toEqual(['71']);
        expect(refs.filter((r) => r.relation === NeighborRelation.Other).map((r) => r.tokenId)).toEqual(['73']);
        expect(refs.filter((r) => r.relation === NeighborRelation.Empty)).toHaveLength(4);
    });

    it('returns five refs for a pentagon-rim cell', () => {
        const refs = classifyNeighbors(makeCell({ tokenId: '1' }), () => null, null);
        expect(refs).toHaveLength(5);
        expect(refs.every((r) => r.relation === NeighborRelation.Empty)).toBe(true);
    });
});

describe('buildResourceIndex', () => {
    it('groups resources by id while keeping each location', () => {
        const cells = [
            makeCell({
                tokenId: '1',
                resources: [
                    { resourceId: 1, deposit: '10', balance: '5', strength: 3, storage: null },
                    { resourceId: 2, deposit: '0', balance: '3', strength: null, storage: null },
                ],
            }),
            makeCell({
                tokenId: '2',
                resources: [{ resourceId: 1, deposit: '0', balance: '7', strength: null, storage: null }],
            }),
        ];

        const index = buildResourceIndex(cells);

        expect(index['1']).toHaveLength(2);
        expect(index['2']).toHaveLength(1);
        expect(index['1']?.[0]?.tokenId).toBe('1');
    });
});

describe('filterCells', () => {
    const cells = [
        makeCell({ tokenId: '72', owner: '0xme' }),
        makeCell({ tokenId: '74', owner: '0xRival' }),
        makeCell({ tokenId: '10000', owner: '0xme' }),
    ];

    it('returns everything for scope=all', () => {
        expect(filterCells(cells, query({ scope: MapScope.All }))).toHaveLength(3);
    });

    it('returns nothing for scope=summary', () => {
        expect(filterCells(cells, query({ scope: MapScope.Summary }))).toHaveLength(0);
    });

    it('matches owner case-insensitively for scope=mine', () => {
        const result = filterCells(cells, query({ scope: MapScope.Mine, ownerAddress: '0xME' }));
        expect(result.map((c) => c.tokenId)).toEqual(['72', '10000']);
    });

    it('includes the radius boundary for scope=around', () => {
        const near = filterCells(cells, query({ scope: MapScope.Around, around: { tokenId: '72', radius: 1 } }));
        expect(near.map((c) => c.tokenId)).toEqual(['72']);

        const wider = filterCells(cells, query({ scope: MapScope.Around, around: { tokenId: '72', radius: 2 } }));
        expect(wider.map((c) => c.tokenId)).toEqual(['72', '74']);
    });

    it('matches the token set for scope=cells', () => {
        const result = filterCells(cells, query({ scope: MapScope.Cells, tokenIds: ['10000'] }));
        expect(result.map((c) => c.tokenId)).toEqual(['10000']);
    });
});

describe('summarizeMap', () => {
    const base = {
        readiness: MapReadiness.Ready,
        socketConnected: true,
        version: 50,
        serverTime: 1000,
        totalCells: 4,
    };

    it('leaves owner figures null when the owner is unknown', () => {
        const summary = summarizeMap({ ...base, ownedCells: null });
        expect(summary.myCells).toBeNull();
        expect(summary.myCellsByStatus).toBeNull();
        expect(summary.depletedDeposits).toBeNull();
    });

    it('counts statuses and depleted deposits over owned cells', () => {
        const ownedCells = [
            makeCell({
                tokenId: 'm',
                revealCount: 1,
                process: makeMiningProcess({ resource: 1, startAt: 1 }),
                resources: [
                    makeResource({ resourceId: 1, deposit: '1000', storage: makeStorage({ used: '50', cap: '50' }) }),
                ],
            }),
            makeCell({
                tokenId: 'c',
                revealCount: 1,
                process: makeCraftProcess({ recipeId: 'r', startAt: 1 }),
            }),
            makeCell({ tokenId: 'i', revealCount: 1 }),
            makeCell({
                tokenId: 'd',
                revealCount: 1,
                resources: [makeResource({ resourceId: 1, deposit: '0' })],
            }),
        ].map((cell) => projectCell(cell));

        const summary = summarizeMap({ ...base, ownedCells });

        expect(summary.myCells).toBe(4);
        expect(summary.myCellsByStatus).toEqual({ idle: 2, mining: 1, crafting: 1 });
        expect(summary.depletedDeposits).toBe(1);
        expect(summary.stalledCells).toBe(1);
    });
});
