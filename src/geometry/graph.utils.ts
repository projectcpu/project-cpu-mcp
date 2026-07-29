import { MAX_EDGE_ARC } from './adjacency.data.js';
import { adjacencyTable, neighbors } from './adjacency.js';
import { assertTokenIdInRange } from './cell.utils.js';
import { MAX_TOKEN_ID, NEIGHBOR_SLOTS } from './constants.js';
import { unitVector } from './sphere.utils.js';

export function kRing(tokenId: number, radius: number): Map<number, number> {
    assertTokenIdInRange(tokenId);
    if (!Number.isInteger(radius) || radius < 0) {
        throw new Error(`kRing radius must be a non-negative integer, got ${radius}`);
    }
    const distance = new Map<number, number>([[tokenId, 0]]);
    let frontier = [tokenId];
    for (let depth = 1; depth <= radius; depth++) {
        const next: Array<number> = [];
        for (const node of frontier) {
            for (const neighbor of neighbors(node)) {
                if (distance.has(neighbor)) {
                    continue;
                }
                distance.set(neighbor, depth);
                next.push(neighbor);
            }
        }
        if (next.length === 0) {
            break;
        }
        frontier = next;
    }
    return distance;
}

export function gridDistanceWithin(from: number, to: number, maxSteps: number): number {
    assertTokenIdInRange(from);
    assertTokenIdInRange(to);
    if (from === to) {
        return 0;
    }
    const seen = new Set<number>([from]);
    let frontier = [from];
    for (let depth = 1; depth <= maxSteps; depth++) {
        const next: Array<number> = [];
        for (const node of frontier) {
            for (const neighbor of neighbors(node)) {
                if (seen.has(neighbor)) {
                    continue;
                }
                if (neighbor === to) {
                    return depth;
                }
                seen.add(neighbor);
                next.push(neighbor);
            }
        }
        if (next.length === 0) {
            break;
        }
        frontier = next;
    }
    return -1;
}

const vectorX = new Float64Array(MAX_TOKEN_ID + 1);
const vectorY = new Float64Array(MAX_TOKEN_ID + 1);
const vectorZ = new Float64Array(MAX_TOKEN_ID + 1);
const vectorReady = new Uint8Array(MAX_TOKEN_ID + 1);

function heuristic(tokenId: number, tx: number, ty: number, tz: number): number {
    if (vectorReady[tokenId] === 0) {
        const v = unitVector(tokenId);
        vectorX[tokenId] = v[0];
        vectorY[tokenId] = v[1];
        vectorZ[tokenId] = v[2];
        vectorReady[tokenId] = 1;
    }
    const dot =
        (vectorX[tokenId] as number) * tx + (vectorY[tokenId] as number) * ty + (vectorZ[tokenId] as number) * tz;
    return Math.acos(Math.max(-1, Math.min(1, dot))) / MAX_EDGE_ARC;
}

const cameFrom = new Int32Array(MAX_TOKEN_ID + 1);
const gScore = new Int32Array(MAX_TOKEN_ID + 1);
const gStamp = new Int32Array(MAX_TOKEN_ID + 1);
const closedStamp = new Int32Array(MAX_TOKEN_ID + 1);
let epoch = 0;

export function findPath(from: number, to: number): Array<number> | null {
    assertTokenIdInRange(from);
    assertTokenIdInRange(to);
    if (from === to) {
        return [from];
    }
    const packed = adjacencyTable();
    const [tx, ty, tz] = unitVector(to);
    if (epoch === 2147483647) {
        gStamp.fill(0);
        closedStamp.fill(0);
        epoch = 0;
    }
    epoch += 1;

    const heapNodes: Array<number> = [];
    const heapCosts: Array<number> = [];
    const heapSwap = (a: number, b: number): void => {
        const node = heapNodes[a] as number;
        const cost = heapCosts[a] as number;
        heapNodes[a] = heapNodes[b] as number;
        heapCosts[a] = heapCosts[b] as number;
        heapNodes[b] = node;
        heapCosts[b] = cost;
    };
    const heapPush = (node: number, cost: number): void => {
        let child = heapNodes.length;
        heapNodes.push(node);
        heapCosts.push(cost);
        while (child > 0) {
            const parent = (child - 1) >> 1;
            if ((heapCosts[parent] as number) <= (heapCosts[child] as number)) {
                break;
            }
            heapSwap(parent, child);
            child = parent;
        }
    };
    const heapPop = (): number => {
        const top = heapNodes[0] as number;
        const lastNode = heapNodes.pop() as number;
        const lastCost = heapCosts.pop() as number;
        const size = heapNodes.length;
        if (size > 0) {
            heapNodes[0] = lastNode;
            heapCosts[0] = lastCost;
            let parent = 0;
            for (;;) {
                const left = parent * 2 + 1;
                const right = left + 1;
                let smallest = parent;
                if (left < size && (heapCosts[left] as number) < (heapCosts[smallest] as number)) {
                    smallest = left;
                }
                if (right < size && (heapCosts[right] as number) < (heapCosts[smallest] as number)) {
                    smallest = right;
                }
                if (smallest === parent) {
                    break;
                }
                heapSwap(parent, smallest);
                parent = smallest;
            }
        }
        return top;
    };

    gScore[from] = 0;
    gStamp[from] = epoch;
    cameFrom[from] = from;
    heapPush(from, heuristic(from, tx, ty, tz));

    while (heapNodes.length > 0) {
        const current = heapPop();
        if (current === to) {
            const path = [to];
            let cursor = to;
            while (cursor !== from) {
                cursor = cameFrom[cursor] as number;
                path.push(cursor);
            }
            return path.reverse();
        }
        if (closedStamp[current] === epoch) {
            continue;
        }
        closedStamp[current] = epoch;
        const base = (current - 1) * NEIGHBOR_SLOTS;
        const tentative = (gScore[current] as number) + 1;
        for (let slot = 0; slot < NEIGHBOR_SLOTS; slot++) {
            const neighbor = packed[base + slot] ?? 0;
            if (neighbor === 0 || closedStamp[neighbor] === epoch) {
                continue;
            }
            if (gStamp[neighbor] !== epoch || tentative < (gScore[neighbor] as number)) {
                gScore[neighbor] = tentative;
                gStamp[neighbor] = epoch;
                cameFrom[neighbor] = current;
                heapPush(neighbor, tentative + heuristic(neighbor, tx, ty, tz));
            }
        }
    }
    return null;
}
