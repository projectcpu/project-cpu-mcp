import type { CellResource, CellResourceStorage, ProcessOutput } from './types.js';

export function warehouseRoom(storage: CellResourceStorage | null): bigint | null {
    if (storage === null || storage.cap === null) {
        return null;
    }
    const used = BigInt(storage.used);
    const cap = BigInt(storage.cap);
    return cap > used ? cap - used : 0n;
}

export function needByResource(outputs: ReadonlyArray<ProcessOutput>): Map<number, bigint> {
    const need = new Map<number, bigint>();
    for (const output of outputs) {
        need.set(output.resourceId, (need.get(output.resourceId) ?? 0n) + BigInt(output.amount));
    }
    return need;
}

function roomFor(resources: ReadonlyArray<CellResource>, resourceId: number): bigint | null {
    const resource = resources.find((r) => r.resourceId === resourceId);
    return resource === undefined ? null : warehouseRoom(resource.storage);
}

export function fitBatchesByRoom(
    outputs: ReadonlyArray<ProcessOutput>,
    resources: ReadonlyArray<CellResource>,
): number | null {
    let fit: bigint | null = null;
    for (const [resourceId, need] of needByResource(outputs)) {
        const room = roomFor(resources, resourceId);
        if (room === null) {
            continue;
        }
        const batches = need > 0n ? room / need : room;
        fit = fit === null || batches < fit ? batches : fit;
    }
    return fit === null ? null : Number(fit);
}

export function blockedResourceIds(
    outputs: ReadonlyArray<ProcessOutput>,
    resources: ReadonlyArray<CellResource>,
): Array<number> {
    const blocked: Array<number> = [];
    for (const [resourceId, need] of needByResource(outputs)) {
        const room = roomFor(resources, resourceId);
        if (need > 0n && room !== null && room < need) {
            blocked.push(resourceId);
        }
    }
    return blocked;
}

export function isProcessStalled(
    outputs: ReadonlyArray<ProcessOutput>,
    resources: ReadonlyArray<CellResource>,
): boolean {
    return blockedResourceIds(outputs, resources).length > 0;
}
