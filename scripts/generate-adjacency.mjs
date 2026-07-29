#!/usr/bin/env node
// Regenerates src/geometry/adjacency.data.ts. Usage: node scripts/generate-adjacency.mjs

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const N = 70;
const RHOMBUS_COUNT = 10;
const HEXES_PER_RHOMBUS = N * N - 1;
const HEX_COUNT = RHOMBUS_COUNT * HEXES_PER_RHOMBUS;
const CELL_COUNT = RHOMBUS_COUNT * N * N + 2;
const NEIGHBOR_SLOTS = 6;


const normalize = (v) => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
};

const distanceSquared = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

const azimuth = (v) => Math.atan2(v[1], v[0]);

const icosahedronVertices = () => {
    const z = 1 / Math.sqrt(5);
    const r = 2 / Math.sqrt(5);
    const deg = Math.PI / 180;
    const vertices = [[0, 0, 1]];
    for (let k = 0; k < 5; k++) {
        vertices.push(normalize([r * Math.cos(k * 72 * deg), r * Math.sin(k * 72 * deg), z]));
    }
    for (let k = 0; k < 5; k++) {
        vertices.push(normalize([r * Math.cos((36 + k * 72) * deg), r * Math.sin((36 + k * 72) * deg), -z]));
    }
    vertices.push([0, 0, -1]);
    return vertices;
};

const icosahedronAdjacency = (vertices) => {
    const n = vertices.length;
    let min = Infinity;
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) min = Math.min(min, distanceSquared(vertices[i], vertices[j]));
    }
    const adjacency = Array.from({ length: n }, () => Array(n).fill(false));
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (Math.abs(distanceSquared(vertices[i], vertices[j]) - min) < 1e-9) {
                adjacency[i][j] = true;
                adjacency[j][i] = true;
            }
        }
    }
    return adjacency;
};

const buildRhombusCorners = () => {
    const vertices = icosahedronVertices();
    const adjacency = icosahedronAdjacency(vertices);
    const indices = vertices.map((_, i) => i);
    const north = indices.reduce((a, b) => (vertices[b][2] > vertices[a][2] ? b : a), 0);
    const south = indices.reduce((a, b) => (vertices[b][2] < vertices[a][2] ? b : a), 0);
    const upper = indices
        .filter((i) => i !== north && i !== south && vertices[i][2] > 0)
        .sort((a, b) => azimuth(vertices[a]) - azimuth(vertices[b]));
    const lower = indices
        .filter((i) => i !== north && i !== south && vertices[i][2] < 0)
        .sort((a, b) => azimuth(vertices[a]) - azimuth(vertices[b]));

    const commonNeighbor = (a, b, pool) => {
        const found = pool.filter((x) => adjacency[a][x] && adjacency[b][x]);
        if (found.length !== 1) throw new Error(`ambiguous shared vertex: ${found.length}`);
        return found[0];
    };

    const corners = [];
    for (let k = 0; k < 5; k++) {
        const u0 = upper[k];
        const u1 = upper[(k + 1) % 5];
        corners.push([vertices[u0], vertices[north], vertices[u1], vertices[commonNeighbor(u0, u1, lower)]]);
    }
    for (let k = 0; k < 5; k++) {
        const l0 = lower[k];
        const l1 = lower[(k + 1) % 5];
        corners.push([vertices[l0], vertices[south], vertices[l1], vertices[commonNeighbor(l0, l1, upper)]]);
    }
    return corners;
};

const RHOMBUS_CORNERS = buildRhombusCorners();

const rhombusPoint = (face, i, j) => {
    const [p0, p1, p2, p3] = RHOMBUS_CORNERS[face];
    if (i >= j) {
        const a = (N - i) / N;
        const b = (i - j) / N;
        const c = j / N;
        return normalize([
            a * p0[0] + b * p1[0] + c * p2[0],
            a * p0[1] + b * p1[1] + c * p2[1],
            a * p0[2] + b * p1[2] + c * p2[2],
        ]);
    }
    const a = (N - j) / N;
    const b = (j - i) / N;
    const c = i / N;
    return normalize([
        a * p0[0] + b * p3[0] + c * p2[0],
        a * p0[1] + b * p3[1] + c * p2[1],
        a * p0[2] + b * p3[2] + c * p2[2],
    ]);
};


const isPentagonPosition = (i, j) => (i === 0 || i === N) && (j === 0 || j === N);

const cellToTokenId = (face, i, j) => face * HEXES_PER_RHOMBUS + i * N + j;

const positionKey = (face, i, j) => {
    const p = rhombusPoint(face, i, j);
    const round = (x) => Math.round(x * 1e7) / 1e7;
    return `${round(p[0])},${round(p[1])},${round(p[2])}`;
};

const DIRECTIONS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [-1, -1],
];

const buildRawGrid = () => {
    const keyToCell = new Map();
    const appearances = [];
    const cellFor = (face, i, j) => {
        const key = positionKey(face, i, j);
        let cell = keyToCell.get(key);
        if (cell === undefined) {
            cell = appearances.length;
            keyToCell.set(key, cell);
            appearances.push([]);
        }
        appearances[cell].push([face, i, j]);
        return cell;
    };

    const cellByFaceIJ = [];
    for (let face = 0; face < RHOMBUS_COUNT; face++) {
        cellByFaceIJ[face] = [];
        for (let i = 0; i <= N; i++) {
            cellByFaceIJ[face][i] = [];
            for (let j = 0; j <= N; j++) cellByFaceIJ[face][i][j] = cellFor(face, i, j);
        }
    }

    const cellCount = appearances.length;
    const isPentagonCell = new Array(cellCount).fill(false);
    const tokenOfCell = new Array(cellCount).fill(0);
    for (let cell = 0; cell < cellCount; cell++) {
        for (const [, i, j] of appearances[cell]) if (isPentagonPosition(i, j)) isPentagonCell[cell] = true;
    }
    for (let cell = 0; cell < cellCount; cell++) {
        if (isPentagonCell[cell]) continue;
        const owner = appearances[cell].find(([, i, j]) => i < N && j < N && !(i === 0 && j === 0));
        if (!owner) throw new Error(`hex cell ${cell} has no owner rhombus`);
        tokenOfCell[cell] = cellToTokenId(owner[0], owner[1], owner[2]);
    }

    return { cellCount, appearances, cellByFaceIJ, isPentagonCell, tokenOfCell };
};

const buildAdjacency = () => {
    const { cellCount, appearances, cellByFaceIJ, isPentagonCell, tokenOfCell } = buildRawGrid();
    if (cellCount !== CELL_COUNT) throw new Error(`expected ${CELL_COUNT} cells, got ${cellCount}`);

    const neighborSets = Array.from({ length: HEX_COUNT + 1 }, () => new Set());
    for (let cell = 0; cell < cellCount; cell++) {
        if (isPentagonCell[cell]) continue;
        const token = tokenOfCell[cell];
        for (const [face, i, j] of appearances[cell]) {
            for (const [di, dj] of DIRECTIONS) {
                const ni = i + di;
                const nj = j + dj;
                if (ni < 0 || ni > N || nj < 0 || nj > N) continue;
                const other = cellByFaceIJ[face][ni][nj];
                if (other === cell || isPentagonCell[other]) continue;
                neighborSets[token].add(tokenOfCell[other]);
            }
        }
    }

    const table = new Uint16Array(HEX_COUNT * NEIGHBOR_SLOTS);
    for (let token = 1; token <= HEX_COUNT; token++) {
        const sorted = [...neighborSets[token]].sort((a, b) => a - b);
        if (sorted.length < 5 || sorted.length > 6) {
            throw new Error(`token ${token} has ${sorted.length} neighbors`);
        }
        for (let k = 0; k < sorted.length; k++) table[(token - 1) * NEIGHBOR_SLOTS + k] = sorted[k];
    }
    return table;
};


const verify = (table) => {
    const degreeOf = (token) => {
        let d = 0;
        for (let k = 0; k < NEIGHBOR_SLOTS; k++) if (table[(token - 1) * NEIGHBOR_SLOTS + k] !== 0) d++;
        return d;
    };

    let fives = 0;
    for (let token = 1; token <= HEX_COUNT; token++) {
        const d = degreeOf(token);
        if (d === 5) fives++;
        else if (d !== 6) throw new Error(`token ${token} has degree ${d}`);
        for (let k = 0; k < NEIGHBOR_SLOTS; k++) {
            const nb = table[(token - 1) * NEIGHBOR_SLOTS + k];
            if (nb === 0) continue;
            let mutual = false;
            for (let m = 0; m < NEIGHBOR_SLOTS; m++) {
                if (table[(nb - 1) * NEIGHBOR_SLOTS + m] === token) mutual = true;
            }
            if (!mutual) throw new Error(`asymmetric edge ${token} -> ${nb}`);
        }
    }
    if (fives !== 60) throw new Error(`expected 60 five-neighbor cells, got ${fives}`);

    const seen = new Uint8Array(HEX_COUNT + 1);
    let frontier = [1];
    seen[1] = 1;
    let reached = 1;
    while (frontier.length > 0) {
        const next = [];
        for (const token of frontier) {
            for (let k = 0; k < NEIGHBOR_SLOTS; k++) {
                const nb = table[(token - 1) * NEIGHBOR_SLOTS + k];
                if (nb === 0 || seen[nb] === 1) continue;
                seen[nb] = 1;
                reached++;
                next.push(nb);
            }
        }
        frontier = next;
    }
    if (reached !== HEX_COUNT) throw new Error(`graph is disconnected: reached ${reached} of ${HEX_COUNT}`);
};


const tokenIdToCell = (tokenId) => {
    const zeroBased = tokenId - 1;
    const face = Math.floor(zeroBased / HEXES_PER_RHOMBUS);
    const raw = (zeroBased % HEXES_PER_RHOMBUS) + 1;
    return [face, Math.floor(raw / N), raw % N];
};

const computeMaxEdgeArc = (table) => {
    const vectors = new Float64Array((HEX_COUNT + 1) * 3);
    for (let token = 1; token <= HEX_COUNT; token++) {
        const [face, i, j] = tokenIdToCell(token);
        const p = rhombusPoint(face, i, j);
        vectors[token * 3] = p[0];
        vectors[token * 3 + 1] = p[1];
        vectors[token * 3 + 2] = p[2];
    }
    let max = 0;
    for (let token = 1; token <= HEX_COUNT; token++) {
        for (let k = 0; k < NEIGHBOR_SLOTS; k++) {
            const nb = table[(token - 1) * NEIGHBOR_SLOTS + k];
            if (nb === 0 || nb < token) continue;
            const dot =
                vectors[token * 3] * vectors[nb * 3] +
                vectors[token * 3 + 1] * vectors[nb * 3 + 1] +
                vectors[token * 3 + 2] * vectors[nb * 3 + 2];
            const arc = Math.acos(Math.max(-1, Math.min(1, dot)));
            if (arc > max) max = arc;
        }
    }
    return max;
};

const table = buildAdjacency();
verify(table);
const maxEdgeArc = computeMaxEdgeArc(table);

const bytes = new Uint8Array(table.length * 2);
for (let idx = 0; idx < table.length; idx++) {
    bytes[idx * 2] = table[idx] & 0xff;
    bytes[idx * 2 + 1] = table[idx] >> 8;
}
const base64 = Buffer.from(bytes).toString('base64');

const CHUNK = 4096;
const chunks = [];
for (let offset = 0; offset < base64.length; offset += CHUNK) {
    chunks.push(base64.slice(offset, offset + CHUNK));
}

const header = `/* eslint-disable */
// Generated by scripts/generate-adjacency.mjs — do not edit.
`;

const body =
    `export const MAX_EDGE_ARC = ${maxEdgeArc};\n\n` +
    `export const ADJACENCY_BASE64: string = [\n${chunks.map((c) => `    '${c}',`).join('\n')}\n].join('');\n`;

const outPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'geometry', 'adjacency.data.ts');
writeFileSync(outPath, header + body);
process.stdout.write(`wrote ${outPath} (${base64.length} base64 chars)\n`);
