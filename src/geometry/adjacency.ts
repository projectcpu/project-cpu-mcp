import { ADJACENCY_BASE64 } from './adjacency.data.js';
import { assertTokenIdInRange } from './cell.utils.js';
import { HEX_COUNT, NEIGHBOR_SLOTS } from './constants.js';

let cachedTable: Uint16Array | null = null;

function decodeTable(): Uint16Array {
    const bytes = Buffer.from(ADJACENCY_BASE64, 'base64');
    const expected = HEX_COUNT * NEIGHBOR_SLOTS * 2;
    if (bytes.length !== expected) {
        throw new Error(`adjacency table is corrupt: expected ${expected} bytes, got ${bytes.length}`);
    }
    const table = new Uint16Array(HEX_COUNT * NEIGHBOR_SLOTS);
    for (let k = 0; k < table.length; k++) {
        table[k] = (bytes[k * 2] ?? 0) | ((bytes[k * 2 + 1] ?? 0) << 8);
    }
    return table;
}

export function adjacencyTable(): Uint16Array {
    return (cachedTable ??= decodeTable());
}

export function neighbors(tokenId: number): Array<number> {
    assertTokenIdInRange(tokenId);
    const packed = adjacencyTable();
    const base = (tokenId - 1) * NEIGHBOR_SLOTS;
    const result: Array<number> = [];
    for (let slot = 0; slot < NEIGHBOR_SLOTS; slot++) {
        const neighbor = packed[base + slot] ?? 0;
        if (neighbor !== 0) {
            result.push(neighbor);
        }
    }
    return result;
}
