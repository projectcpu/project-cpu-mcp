import { describe, expect, it } from 'vitest';

import { neighbors } from '../adjacency.js';
import { cellToTokenId, isPentagonPosition, tokenIdToCell } from '../cell.utils.js';
import { GRID_FREQUENCY, HEX_COUNT, MAX_TOKEN_ID, MIN_TOKEN_ID } from '../constants.js';
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

    it('is a single connected component of all 48990 cells', () => {
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
        const interior = cellToTokenId({ face: 0, i: 35, j: 35 });
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
        const interior = cellToTokenId({ face: 0, i: 35, j: 35 });
        const far = cellToTokenId({ face: 5, i: 35, j: 35 });
        expect(gridDistanceWithin(interior, far, 3)).toBe(-1);
    });

    it('findPath yields a shortest chain of adjacent cells with correct endpoints', () => {
        const from = cellToTokenId({ face: 0, i: 30, j: 30 });
        const to = cellToTokenId({ face: 0, i: 35, j: 33 });
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
        const from = cellToTokenId({ face: 0, i: 1, j: 35 });
        const to = cellToTokenId({ face: 4, i: 35, j: 1 });
        const path = findPath(from, to);
        expect(path).not.toBeNull();
        const chain = path as Array<number>;
        const faces = new Set(chain.map((token) => tokenIdToCell(token).face));
        expect(faces.size).toBeGreaterThan(1);
    });

    it('findPath stays shortest on long near-antipodal routes', () => {
        const pairs: Array<[number, number]> = [
            [cellToTokenId({ face: 0, i: 35, j: 35 }), cellToTokenId({ face: 9, i: 35, j: 35 })],
            [cellToTokenId({ face: 1, i: 5, j: 60 }), cellToTokenId({ face: 7, i: 60, j: 5 })],
            [1, cellToTokenId({ face: 6, i: 40, j: 20 })],
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
        for (const bad of ['0', '48991', 'abc', '', '1.5', '-3', 0, MAX_TOKEN_ID + 1, 1.5]) {
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
        const far = String(cellToTokenId({ face: 5, i: 35, j: 35 }));
        expect(nearestDistanceWithin('1', new Set([far]), 2)).toBeNull();
        expect(nearestDistanceWithin('1', new Set<string>(), 3)).toBeNull();
    });

    it('tokenIdToPos matches the bijection', () => {
        expect(tokenIdToPos('1')).toEqual({ face: 0, i: 0, j: 1 });
        expect(tokenIdToPos(String(MAX_TOKEN_ID))).toEqual({ face: 9, i: 69, j: 69 });
    });
});
