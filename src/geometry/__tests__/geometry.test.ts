import { describe, expect, it } from 'vitest';

import { ADJACENCY_BASE64 } from '../adjacency.data.js';
import { neighbors } from '../adjacency.js';
import { cellToTokenId, isPentagonPosition, tokenIdToCell } from '../cell.utils.js';
import {
    GRID_FREQUENCY,
    HEXES_PER_RHOMBUS,
    HEX_COUNT,
    MAX_TOKEN_ID,
    MIN_TOKEN_ID,
    NEIGHBOR_SLOTS,
    RHOMBUS_COUNT,
} from '../constants.js';
import { findPath, gridDistanceWithin, kRing } from '../graph.utils.js';
import { nearestDistanceWithin, neighborTokenIds, parseTokenId, ringDistances, tokenIdToPos } from '../token.utils.js';

describe('tokenId ↔ cell bijection', () => {
    it('round-trips every tokenId without collisions', () => {
        const seen = new Set<string>();
        for (let tokenId = MIN_TOKEN_ID; tokenId <= MAX_TOKEN_ID; tokenId++) {
            const cell = tokenIdToCell(tokenId);
            expect(isPentagonPosition(cell.i, cell.j)).toBe(false);
            expect(cellToTokenId(cell)).toBe(tokenId);
            const key = `${cell.face},${cell.i},${cell.j}`;
            expect(seen.has(key)).toBe(false);
            seen.add(key);
        }
        expect(seen.size).toBe(HEX_COUNT);
    });

    it('rejects out-of-range tokenIds', () => {
        expect(() => tokenIdToCell(0)).toThrow();
        expect(() => tokenIdToCell(MAX_TOKEN_ID + 1)).toThrow();
        expect(() => tokenIdToCell(1.5)).toThrow();
    });

    it('rejects the pentagon corner and out-of-range coords', () => {
        expect(() => cellToTokenId({ face: 0, i: 0, j: 0 })).toThrow();
        expect(() => cellToTokenId({ face: 10, i: 1, j: 1 })).toThrow();
        expect(() => cellToTokenId({ face: 0, i: GRID_FREQUENCY, j: 1 })).toThrow();
    });
});

describe('adjacency table invariants', () => {
    it('has exactly 60 five-neighbor cells (pentagon rims) and 6 neighbors everywhere else', () => {
        let fives = 0;
        for (let tokenId = MIN_TOKEN_ID; tokenId <= MAX_TOKEN_ID; tokenId++) {
            const count = neighbors(tokenId).length;
            if (count === 5) {
                fives += 1;
            } else {
                expect(count).toBe(6);
            }
        }
        expect(fives).toBe(60);
    });

    it('is symmetric with no self-loops or duplicates', () => {
        for (let tokenId = MIN_TOKEN_ID; tokenId <= MAX_TOKEN_ID; tokenId++) {
            const list = neighbors(tokenId);
            expect(new Set(list).size).toBe(list.length);
            for (const neighbor of list) {
                expect(neighbor).not.toBe(tokenId);
                expect(neighbors(neighbor)).toContain(tokenId);
            }
        }
    });

    it('is a single connected component of every cell in the world', () => {
        const seen = new Set<number>([MIN_TOKEN_ID]);
        let frontier = [MIN_TOKEN_ID];
        while (frontier.length > 0) {
            const next: Array<number> = [];
            for (const node of frontier) {
                for (const neighbor of neighbors(node)) {
                    if (!seen.has(neighbor)) {
                        seen.add(neighbor);
                        next.push(neighbor);
                    }
                }
            }
            frontier = next;
        }
        expect(seen.size).toBe(HEX_COUNT);
    });

    it('matches the closed-form neighbor offsets on rhombus-interior cells', () => {
        for (let tokenId = MIN_TOKEN_ID; tokenId <= MAX_TOKEN_ID; tokenId += 97) {
            const { i, j } = tokenIdToCell(tokenId);
            if (i < 2 || i > GRID_FREQUENCY - 2 || j < 2 || j > GRID_FREQUENCY - 2) {
                continue;
            }
            const expected = [
                tokenId - GRID_FREQUENCY - 1,
                tokenId - GRID_FREQUENCY,
                tokenId - 1,
                tokenId + 1,
                tokenId + GRID_FREQUENCY,
                tokenId + GRID_FREQUENCY + 1,
            ];
            expect(neighbors(tokenId)).toEqual(expected);
        }
    });
});

describe('graph operations', () => {
    it('kRing contains the center at 0 and direct neighbors at 1', () => {
        const ring = kRing(1, 1);
        expect(ring.get(1)).toBe(0);
        for (const neighbor of neighbors(1)) {
            expect(ring.get(neighbor)).toBe(1);
        }
        expect(ring.size).toBe(1 + neighbors(1).length);
    });

    it('kRing size is exactly 1+3r(r+1) away from pentagons and never above it', () => {
        const interior = cellToTokenId({ face: 0, i: 27, j: 27 });
        for (const radius of [1, 2, 3, 5]) {
            const ring = kRing(interior, radius);
            expect(ring.size).toBe(1 + 3 * radius * (radius + 1));
        }
        const nearPentagon = kRing(1, 3);
        expect(nearPentagon.size).toBeLessThanOrEqual(1 + 3 * 3 * 4);
    });

    it('gridDistanceWithin returns 0/1 for identity/neighbors and -1 beyond the cap', () => {
        expect(gridDistanceWithin(1, 1, 0)).toBe(0);
        const neighbor = neighbors(1)[0] as number;
        expect(gridDistanceWithin(1, neighbor, 5)).toBe(1);
        expect(gridDistanceWithin(neighbor, 1, 5)).toBe(1);
        const interior = cellToTokenId({ face: 0, i: 27, j: 27 });
        const far = cellToTokenId({ face: 5, i: 27, j: 27 });
        expect(gridDistanceWithin(interior, far, 3)).toBe(-1);
    });

    it('findPath yields a shortest chain of adjacent cells with correct endpoints', () => {
        const from = cellToTokenId({ face: 0, i: 22, j: 22 });
        const to = cellToTokenId({ face: 0, i: 27, j: 25 });
        const path = findPath(from, to);
        expect(path).not.toBeNull();
        const chain = path as Array<number>;
        expect(chain[0]).toBe(from);
        expect(chain[chain.length - 1]).toBe(to);
        for (let k = 1; k < chain.length; k++) {
            expect(neighbors(chain[k - 1] as number)).toContain(chain[k]);
        }
        expect(chain.length - 1).toBe(gridDistanceWithin(from, to, 50));
    });

    it('findPath crosses face seams', () => {
        const from = cellToTokenId({ face: 0, i: 1, j: 27 });
        const to = cellToTokenId({ face: 4, i: 27, j: 1 });
        const path = findPath(from, to);
        expect(path).not.toBeNull();
        const chain = path as Array<number>;
        const faces = new Set(chain.map((token) => tokenIdToCell(token).face));
        expect(faces.size).toBeGreaterThan(1);
    });

    it('findPath stays shortest on long near-antipodal routes', () => {
        const pairs: Array<[number, number]> = [
            [cellToTokenId({ face: 0, i: 27, j: 27 }), cellToTokenId({ face: 9, i: 27, j: 27 })],
            [cellToTokenId({ face: 1, i: 5, j: 46 }), cellToTokenId({ face: 7, i: 46, j: 5 })],
            [1, cellToTokenId({ face: 6, i: 31, j: 15 })],
        ];
        for (const [from, to] of pairs) {
            const path = findPath(from, to) as Array<number>;
            expect(path[0]).toBe(from);
            expect(path[path.length - 1]).toBe(to);
            for (let k = 1; k < path.length; k++) {
                expect(neighbors(path[k - 1] as number)).toContain(path[k]);
            }
            expect(path.length - 1).toBe(gridDistanceWithin(from, to, 300));
        }
    });
});

describe('token.utils string adapters', () => {
    it('parseTokenId accepts strings and numbers in range and rejects the rest', () => {
        expect(parseTokenId('1')).toBe(1);
        expect(parseTokenId(72)).toBe(72);
        expect(parseTokenId(String(MAX_TOKEN_ID))).toBe(MAX_TOKEN_ID);
        for (const bad of ['0', '29151', 'abc', '', '1.5', '-3', 0, MAX_TOKEN_ID + 1, 1.5]) {
            expect(() => parseTokenId(bad)).toThrow(/tokenId must be an integer/);
        }
    });

    it('neighborTokenIds and ringDistances speak strings', () => {
        expect(neighborTokenIds('1')).toEqual(neighbors(1).map(String));
        const ring = ringDistances('1', 1);
        expect(ring.get('1')).toBe(0);
        expect(ring.get(String(neighbors(1)[0]))).toBe(1);
    });

    it('nearestDistanceWithin finds a target at its BFS depth and null beyond the cap', () => {
        const neighbor = String(neighbors(1)[0] as number);
        expect(nearestDistanceWithin('1', new Set([neighbor]), 5)).toBe(1);
        expect(nearestDistanceWithin('1', new Set(['1']), 5)).toBe(0);
        const far = String(cellToTokenId({ face: 5, i: 27, j: 27 }));
        expect(nearestDistanceWithin('1', new Set([far]), 2)).toBeNull();
        expect(nearestDistanceWithin('1', new Set<string>(), 3)).toBeNull();
    });

    it('tokenIdToPos matches the bijection', () => {
        expect(tokenIdToPos('1')).toEqual({ face: 0, i: 0, j: 1 });
        expect(tokenIdToPos(String(MAX_TOKEN_ID))).toEqual({ face: 9, i: 53, j: 53 });
    });
});

describe('world bounds', () => {
    it('spans exactly the launch token domain', () => {
        expect(GRID_FREQUENCY).toBe(54);
        expect(HEXES_PER_RHOMBUS).toBe(2915);
        expect(HEX_COUNT).toBe(29150);
        expect(MAX_TOKEN_ID).toBe(29150);
        expect(MIN_TOKEN_ID).toBe(1);
    });

    it('accepts the first and last token id and rejects everything outside the world', () => {
        expect(parseTokenId(MIN_TOKEN_ID)).toBe(1);
        expect(parseTokenId(29150)).toBe(29150);
        for (const outside of [0, -1, 29151, 48990]) {
            expect(() => parseTokenId(outside)).toThrow(/tokenId must be an integer/);
        }
        expect(() => tokenIdToCell(29151)).toThrow();
    });

    it('packs one neighbor row per derived cell in the generated adjacency data', () => {
        const bytes = Buffer.from(ADJACENCY_BASE64, 'base64');
        expect(bytes.length).toBe(HEX_COUNT * NEIGHBOR_SLOTS * 2);
        expect(bytes.length).toBe(349800);
    });
});

describe('the twelve untokenized pentagons', () => {
    it('leaves twelve lattice vertices outside the token domain', () => {
        expect(RHOMBUS_COUNT * GRID_FREQUENCY * GRID_FREQUENCY + 2 - HEX_COUNT).toBe(12);
    });

    it('gives no token id to a rhombus corner', () => {
        expect(isPentagonPosition(0, 0)).toBe(true);
        expect(isPentagonPosition(0, GRID_FREQUENCY)).toBe(true);
        expect(isPentagonPosition(GRID_FREQUENCY, 0)).toBe(true);
        expect(isPentagonPosition(GRID_FREQUENCY, GRID_FREQUENCY)).toBe(true);
        for (let face = 0; face < RHOMBUS_COUNT; face++) {
            expect(() => cellToTokenId({ face, i: 0, j: 0 })).toThrow();
        }
    });

    it('surrounds each missing pentagon with a rim of exactly five cells', () => {
        const rim = new Set<number>();
        for (let tokenId = MIN_TOKEN_ID; tokenId <= MAX_TOKEN_ID; tokenId++) {
            if (neighbors(tokenId).length === 5) {
                rim.add(tokenId);
            }
        }
        expect(rim.size).toBe(60);

        const unvisited = new Set(rim);
        const rimSizes: Array<number> = [];
        while (unvisited.size > 0) {
            const start = unvisited.values().next().value as number;
            unvisited.delete(start);
            let size = 1;
            let frontier = [start];
            while (frontier.length > 0) {
                const next: Array<number> = [];
                for (const node of frontier) {
                    for (const neighbor of neighbors(node)) {
                        if (unvisited.has(neighbor)) {
                            unvisited.delete(neighbor);
                            size += 1;
                            next.push(neighbor);
                        }
                    }
                }
                frontier = next;
            }
            rimSizes.push(size);
        }
        expect(rimSizes).toHaveLength(12);
        expect(rimSizes.every((size) => size === 5)).toBe(true);
    });
});

describe('face seams', () => {
    it('links every rhombus border cell to another face symmetrically', () => {
        let seamEdges = 0;
        for (let face = 0; face < RHOMBUS_COUNT; face++) {
            for (let j = 1; j < GRID_FREQUENCY; j++) {
                const border = cellToTokenId({ face, i: 0, j });
                const crossings = neighbors(border).filter((token) => tokenIdToCell(token).face !== face);
                expect(crossings.length).toBeGreaterThan(0);
                for (const other of crossings) {
                    expect(neighbors(other)).toContain(border);
                    seamEdges += 1;
                }
            }
        }
        expect(seamEdges).toBeGreaterThan(0);
    });

    it('keeps a seam crossing exactly one step away', () => {
        const border = cellToTokenId({ face: 0, i: 0, j: 20 });
        const across = neighbors(border).find((token) => tokenIdToCell(token).face !== 0) as number;
        expect(gridDistanceWithin(border, across, 1)).toBe(1);
        expect(gridDistanceWithin(across, border, 1)).toBe(1);
    });
});

describe('bounded distance', () => {
    it('answers at the exact cap and gives up one step short', () => {
        const from = cellToTokenId({ face: 0, i: 27, j: 27 });
        const to = cellToTokenId({ face: 0, i: 31, j: 24 });
        const distance = gridDistanceWithin(from, to, 300);
        expect(distance).toBeGreaterThan(1);
        expect(gridDistanceWithin(from, to, distance)).toBe(distance);
        expect(gridDistanceWithin(from, to, distance - 1)).toBe(-1);
    });

    it('is symmetric across a seam and bounded by the world diameter', () => {
        const from = cellToTokenId({ face: 0, i: 1, j: 27 });
        const to = cellToTokenId({ face: 6, i: 40, j: 12 });
        const distance = gridDistanceWithin(from, to, 300);
        expect(distance).toBeGreaterThan(0);
        expect(gridDistanceWithin(to, from, 300)).toBe(distance);
    });
});

describe('representative shortest paths', () => {
    it('returns adjacent chains of minimal length for interior, seam and rim endpoints', () => {
        const pairs: Array<[number, number]> = [
            [cellToTokenId({ face: 0, i: 10, j: 10 }), cellToTokenId({ face: 0, i: 20, j: 30 })],
            [cellToTokenId({ face: 2, i: 1, j: 53 }), cellToTokenId({ face: 7, i: 53, j: 1 })],
            [1, cellToTokenId({ face: 9, i: 53, j: 53 })],
            [cellToTokenId({ face: 3, i: 27, j: 27 }), cellToTokenId({ face: 8, i: 27, j: 27 })],
        ];
        for (const [from, to] of pairs) {
            const path = findPath(from, to) as Array<number>;
            expect(path).not.toBeNull();
            expect(path[0]).toBe(from);
            expect(path[path.length - 1]).toBe(to);
            for (let k = 1; k < path.length; k++) {
                expect(neighbors(path[k - 1] as number)).toContain(path[k]);
            }
            expect(new Set(path).size).toBe(path.length);
            expect(path.length - 1).toBe(gridDistanceWithin(from, to, 300));
        }
    });
});
