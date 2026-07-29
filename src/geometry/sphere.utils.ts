import { tokenIdToCell } from './cell.utils.js';
import { GRID_FREQUENCY, RHOMBUS_COUNT } from './constants.js';

export type Vec3 = [number, number, number];

function at<T>(items: Array<T>, index: number): T {
    return items[index] as T;
}

function normalize(v: Vec3): Vec3 {
    const length = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / length, v[1] / length, v[2] / length];
}

function distanceSquared(a: Vec3, b: Vec3): number {
    return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

function azimuth(v: Vec3): number {
    return Math.atan2(v[1], v[0]);
}

function icosahedronVertices(): Array<Vec3> {
    const z = 1 / Math.sqrt(5);
    const r = 2 / Math.sqrt(5);
    const deg = Math.PI / 180;
    const vertices: Array<Vec3> = [[0, 0, 1]];
    for (let k = 0; k < 5; k++) {
        vertices.push(normalize([r * Math.cos(k * 72 * deg), r * Math.sin(k * 72 * deg), z]));
    }
    for (let k = 0; k < 5; k++) {
        vertices.push(normalize([r * Math.cos((36 + k * 72) * deg), r * Math.sin((36 + k * 72) * deg), -z]));
    }
    vertices.push([0, 0, -1]);
    return vertices;
}

function icosahedronAdjacency(vertices: Array<Vec3>): Array<Array<boolean>> {
    const n = vertices.length;
    let min = Infinity;
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            min = Math.min(min, distanceSquared(at(vertices, i), at(vertices, j)));
        }
    }
    const adjacency = Array.from({ length: n }, () => new Array<boolean>(n).fill(false));
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (Math.abs(distanceSquared(at(vertices, i), at(vertices, j)) - min) < 1e-9) {
                at(adjacency, i)[j] = true;
                at(adjacency, j)[i] = true;
            }
        }
    }
    return adjacency;
}

function buildRhombusCorners(): Array<Array<Vec3>> {
    const vertices = icosahedronVertices();
    const adjacency = icosahedronAdjacency(vertices);
    const indices = vertices.map((_, i) => i);
    const north = indices.reduce((a, b) => (at(vertices, b)[2] > at(vertices, a)[2] ? b : a), 0);
    const south = indices.reduce((a, b) => (at(vertices, b)[2] < at(vertices, a)[2] ? b : a), 0);
    const upper = indices
        .filter((i) => i !== north && i !== south && at(vertices, i)[2] > 0)
        .sort((a, b) => azimuth(at(vertices, a)) - azimuth(at(vertices, b)));
    const lower = indices
        .filter((i) => i !== north && i !== south && at(vertices, i)[2] < 0)
        .sort((a, b) => azimuth(at(vertices, a)) - azimuth(at(vertices, b)));

    const commonNeighbor = (a: number, b: number, pool: Array<number>): number => {
        const found = pool.filter((x) => at(adjacency, a)[x] && at(adjacency, b)[x]);
        if (found.length !== 1) {
            throw new Error(`ambiguous shared icosahedron vertex: ${found.length}`);
        }
        return at(found, 0);
    };

    const corners: Array<Array<Vec3>> = [];
    for (let k = 0; k < 5; k++) {
        const u0 = at(upper, k);
        const u1 = at(upper, (k + 1) % 5);
        corners.push([
            at(vertices, u0),
            at(vertices, north),
            at(vertices, u1),
            at(vertices, commonNeighbor(u0, u1, lower)),
        ]);
    }
    for (let k = 0; k < 5; k++) {
        const l0 = at(lower, k);
        const l1 = at(lower, (k + 1) % 5);
        corners.push([
            at(vertices, l0),
            at(vertices, south),
            at(vertices, l1),
            at(vertices, commonNeighbor(l0, l1, upper)),
        ]);
    }
    if (corners.length !== RHOMBUS_COUNT) {
        throw new Error(`expected ${RHOMBUS_COUNT} rhombus faces, got ${corners.length}`);
    }
    return corners;
}

const RHOMBUS_CORNERS = buildRhombusCorners();

export function unitVector(tokenId: number): Vec3 {
    const { face, i, j } = tokenIdToCell(tokenId);
    const [p0, p1, p2, p3] = at(RHOMBUS_CORNERS, face) as [Vec3, Vec3, Vec3, Vec3];
    const m = GRID_FREQUENCY;
    if (i >= j) {
        const a = (m - i) / m;
        const b = (i - j) / m;
        const c = j / m;
        return normalize([
            a * p0[0] + b * p1[0] + c * p2[0],
            a * p0[1] + b * p1[1] + c * p2[1],
            a * p0[2] + b * p1[2] + c * p2[2],
        ]);
    }
    const a = (m - j) / m;
    const b = (j - i) / m;
    const c = i / m;
    return normalize([
        a * p0[0] + b * p3[0] + c * p2[0],
        a * p0[1] + b * p3[1] + c * p2[1],
        a * p0[2] + b * p3[2] + c * p2[2],
    ]);
}
