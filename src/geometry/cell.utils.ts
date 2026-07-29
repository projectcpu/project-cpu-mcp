import { GRID_FREQUENCY, HEXES_PER_RHOMBUS, MAX_TOKEN_ID, MIN_TOKEN_ID, RHOMBUS_COUNT } from './constants.js';
import type { CellCoord } from './types.js';

export function isPentagonPosition(i: number, j: number): boolean {
    return (i === 0 || i === GRID_FREQUENCY) && (j === 0 || j === GRID_FREQUENCY);
}

export function assertTokenIdInRange(tokenId: number): void {
    if (!Number.isInteger(tokenId) || tokenId < MIN_TOKEN_ID || tokenId > MAX_TOKEN_ID) {
        throw new Error(`tokenId must be an integer in [${MIN_TOKEN_ID}, ${MAX_TOKEN_ID}], got ${tokenId}`);
    }
}

export function tokenIdToCell(tokenId: number): CellCoord {
    assertTokenIdInRange(tokenId);
    const zeroBased = tokenId - 1;
    const face = Math.floor(zeroBased / HEXES_PER_RHOMBUS);
    const raw = (zeroBased % HEXES_PER_RHOMBUS) + 1;
    return { face, i: Math.floor(raw / GRID_FREQUENCY), j: raw % GRID_FREQUENCY };
}

export function cellToTokenId(coord: CellCoord): number {
    const { face, i, j } = coord;
    const inRange = (value: number, max: number): boolean => Number.isInteger(value) && value >= 0 && value < max;
    if (!inRange(face, RHOMBUS_COUNT) || !inRange(i, GRID_FREQUENCY) || !inRange(j, GRID_FREQUENCY)) {
        throw new Error(`cellToTokenId: coord out of range ${JSON.stringify(coord)}`);
    }
    if (i === 0 && j === 0) {
        throw new Error('cellToTokenId: (0,0) is a pentagon vertex and has no tokenId');
    }
    return face * HEXES_PER_RHOMBUS + i * GRID_FREQUENCY + j;
}
