import { BASIS_POINTS } from './constants.js';
import {
    type Cell,
    type CellProcessView,
    type CellResource,
    CellProcessKind,
    type ProcessBatchSchedule,
    type ProcessOutput,
    type ProcessProgress,
    type ProcessProjection,
    type ProcessProjectionConfig,
    type ProcessSettlement,
    type ProcessWarehouseEffect,
    type RawCellProcessView,
} from './types.js';

function outputs(process: RawCellProcessView, config: ProcessProjectionConfig): Array<ProcessOutput> {
    if (process.kind === CellProcessKind.Mining) {
        return [{ resourceId: process.resource, amount: process.yieldPerCycle }];
    }
    return config.craftOutputsByRecipe[process.recipeId] ?? [];
}

function warehouseRoom(resources: ReadonlyArray<CellResource>, resourceId: number): bigint | null {
    const storage = resources.find((resource) => resource.resourceId === resourceId)?.storage ?? null;
    if (storage === null || storage.cap === null) {
        return null;
    }
    const used = BigInt(storage.used);
    const cap = BigInt(storage.cap);
    return cap > used ? cap - used : 0n;
}

function warehouseEffects(
    processOutputs: ReadonlyArray<ProcessOutput>,
    resources: ReadonlyArray<CellResource>,
): Array<ProcessWarehouseEffect> {
    const required = new Map<number, bigint>();
    for (const output of processOutputs) {
        required.set(output.resourceId, (required.get(output.resourceId) ?? 0n) + BigInt(output.amount));
    }
    return [...required].map(([resourceId, requiredPerBatch]) => {
        const room = warehouseRoom(resources, resourceId);
        return {
            resourceId,
            requiredPerBatch,
            blocked: requiredPerBatch > 0n && room !== null && room < requiredPerBatch,
        };
    });
}

function fitBatchesByRoom(effects: ReadonlyArray<ProcessWarehouseEffect>, resources: ReadonlyArray<CellResource>) {
    let fit: bigint | null = null;
    for (const effect of effects) {
        const room = warehouseRoom(resources, effect.resourceId);
        if (room === null) {
            continue;
        }
        const batches = effect.requiredPerBatch > 0n ? room / effect.requiredPerBatch : room;
        fit = fit === null || batches < fit ? batches : fit;
    }
    return fit === null ? null : Number(fit);
}

function schedule(process: RawCellProcessView, serverTime: number): ProcessBatchSchedule {
    const remainingBatches = Math.max(0, process.batches - process.claimedBatches);
    const elapsedSec = Math.max(0, serverTime - process.startAt);
    const elapsedBatches = process.durationSec > 0 ? Math.floor(elapsedSec / process.durationSec) : 0;
    const maturedBatches = Math.min(elapsedBatches, remainingBatches);
    return {
        maturedBatches,
        remainingBatches,
        endsAtSec: process.startAt + remainingBatches * process.durationSec,
        nextBatchAtSec:
            maturedBatches >= remainingBatches ? null : process.startAt + (maturedBatches + 1) * process.durationSec,
    };
}

function miningSettlement(
    cell: Cell,
    maturedBatches: number,
    effects: Array<ProcessWarehouseEffect>,
    config: ProcessProjectionConfig,
): ProcessSettlement {
    const process = cell.process;
    if (process === null || process.kind !== CellProcessKind.Mining) {
        throw new Error(`Cell ${cell.tokenId} has no mining process to project.`);
    }
    if (cell.building === null) {
        throw new Error(`Cell ${cell.tokenId} is mining with no building; cannot derive its extraction share.`);
    }
    const extractionShareBp = config.extractionShareBpByBuilding[cell.building.type];
    if (extractionShareBp === undefined) {
        throw new Error(
            `Building type ${cell.building.type} has no extraction share in the config; cannot settle mining ` +
                `on cell ${cell.tokenId}.`,
        );
    }
    const take = BigInt(Math.ceil((process.yieldPerCycle * BASIS_POINTS) / extractionShareBp));
    const depositRemaining = BigInt(
        cell.resources.find((resource) => resource.resourceId === process.resource)?.deposit ?? '0',
    );
    const fitByRoom = fitBatchesByRoom(effects, cell.resources);
    const fitByDeposit = Number((depositRemaining + take - 1n) / take);
    const settledBatches = Math.min(maturedBatches, fitByRoom ?? maturedBatches, fitByDeposit);
    const wouldDrain = BigInt(settledBatches) * take;
    const drainedUnits = wouldDrain > depositRemaining ? depositRemaining : wouldDrain;
    return {
        settledBatches,
        drainedUnits,
        minedUnits: (drainedUnits * BigInt(process.yieldPerCycle)) / take,
        depleted: depositRemaining - drainedUnits === 0n,
    };
}

function settlement(
    cell: Cell,
    maturedBatches: number,
    effects: Array<ProcessWarehouseEffect>,
    config: ProcessProjectionConfig,
): ProcessSettlement {
    if (cell.process?.kind === CellProcessKind.Mining) {
        return miningSettlement(cell, maturedBatches, effects, config);
    }
    const fitByRoom = fitBatchesByRoom(effects, cell.resources);
    return {
        settledBatches: Math.min(maturedBatches, fitByRoom ?? maturedBatches),
        minedUnits: 0n,
        drainedUnits: 0n,
        depleted: false,
    };
}

function progress(
    process: CellProcessView,
    batchSchedule: ProcessBatchSchedule,
    processSettlement: ProcessSettlement,
): ProcessProgress {
    const isFinished = processSettlement.settledBatches >= batchSchedule.remainingBatches || processSettlement.depleted;
    return {
        completedBatches: process.claimedBatches + processSettlement.settledBatches,
        claimableBatches: processSettlement.settledBatches,
        isFinished,
        endsAtSec: batchSchedule.endsAtSec,
        nextBatchAtSec: isFinished || process.stalled ? null : batchSchedule.nextBatchAtSec,
    };
}

export function deriveCellProcess(
    process: RawCellProcessView | null,
    resources: Array<CellResource>,
    config: ProcessProjectionConfig,
): CellProcessView | null {
    if (process === null) {
        return null;
    }
    const effects = warehouseEffects(outputs(process, config), resources);
    return { ...process, stalled: effects.some((effect) => effect.blocked) };
}

export function projectCellProcess(
    cell: Cell,
    serverTime: number,
    config: ProcessProjectionConfig,
): ProcessProjection | null {
    const process = cell.process;
    if (process === null) {
        return null;
    }
    const processOutputs = outputs(process, config);
    const effects = warehouseEffects(processOutputs, cell.resources);
    const batchSchedule = schedule(process, serverTime);
    const processSettlement = settlement(cell, batchSchedule.maturedBatches, effects, config);
    return {
        warehouseEffects: effects,
        progress: progress(process, batchSchedule, processSettlement),
        settlement: processSettlement,
    };
}
