import { configuredStorageCap, usesHubShelf } from './storage.utils.js';
import {
    type Cell,
    type CellProjectionConfig,
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

function warehouseRoom(
    resources: ReadonlyArray<CellResource>,
    resourceId: number,
    config: ProcessProjectionConfig,
    useHubShelf: boolean,
): bigint | null {
    const resource = resources.find((candidate) => candidate.resourceId === resourceId);
    if (resource === undefined || resource.storage === null) {
        return configuredStorageCap(resourceId, useHubShelf, config);
    }
    if (resource.storage.cap === null) {
        return null;
    }
    const used = BigInt(resource.storage.used);
    const cap = BigInt(resource.storage.cap);
    return cap > used ? cap - used : 0n;
}

function warehouseEffects(
    processOutputs: ReadonlyArray<ProcessOutput>,
    resources: ReadonlyArray<CellResource>,
    config: ProcessProjectionConfig,
    useHubShelf: boolean,
): Array<ProcessWarehouseEffect> {
    const required = new Map<number, bigint>();
    for (const output of processOutputs) {
        required.set(output.resourceId, (required.get(output.resourceId) ?? 0n) + BigInt(output.amount));
    }
    return [...required].map(([resourceId, requiredPerBatch]) => {
        const room = warehouseRoom(resources, resourceId, config, useHubShelf);
        return {
            resourceId,
            requiredPerBatch,
            blocked: requiredPerBatch > 0n && room !== null && room < requiredPerBatch,
        };
    });
}

function fitBatchesByRoom(
    effects: ReadonlyArray<ProcessWarehouseEffect>,
    resources: ReadonlyArray<CellResource>,
    config: ProcessProjectionConfig,
    useHubShelf: boolean,
) {
    let fit: bigint | null = null;
    for (const effect of effects) {
        const room = warehouseRoom(resources, effect.resourceId, config, useHubShelf);
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

function hasRemainingProduction(process: RawCellProcessView, resources: ReadonlyArray<CellResource>): boolean {
    if (process.batches <= process.claimedBatches) {
        return false;
    }
    return (
        process.kind === CellProcessKind.Craft ||
        BigInt(resources.find((resource) => resource.resourceId === process.resource)?.deposit ?? '0') > 0n
    );
}

function miningSettlement(
    cell: Cell,
    maturedBatches: number,
    effects: Array<ProcessWarehouseEffect>,
    config: ProcessProjectionConfig,
    useHubShelf: boolean,
): ProcessSettlement {
    const process = cell.process;
    if (process === null || process.kind !== CellProcessKind.Mining) {
        throw new Error(`Cell ${cell.tokenId} has no mining process to project.`);
    }
    const yieldPerCycle = BigInt(process.yieldPerCycle);
    const take = process.processDrawPerCycle === 0 ? yieldPerCycle : BigInt(process.processDrawPerCycle);
    const depositRemaining = BigInt(
        cell.resources.find((resource) => resource.resourceId === process.resource)?.deposit ?? '0',
    );
    if (yieldPerCycle <= 0n || take <= 0n) {
        return {
            settledBatches: 0,
            drainedUnits: 0n,
            minedUnits: 0n,
            depleted: depositRemaining === 0n,
        };
    }
    const fitByRoom = fitBatchesByRoom(effects, cell.resources, config, useHubShelf);
    const fitByDeposit = Number((depositRemaining + take - 1n) / take);
    const settledBatches = Math.min(maturedBatches, fitByRoom ?? maturedBatches, fitByDeposit);
    const wouldDrain = BigInt(settledBatches) * take;
    const drainedUnits = wouldDrain > depositRemaining ? depositRemaining : wouldDrain;
    return {
        settledBatches,
        drainedUnits,
        minedUnits: (drainedUnits * yieldPerCycle) / take,
        depleted: depositRemaining - drainedUnits === 0n,
    };
}

function settlement(
    cell: Cell,
    maturedBatches: number,
    effects: Array<ProcessWarehouseEffect>,
    config: ProcessProjectionConfig,
    useHubShelf: boolean,
): ProcessSettlement {
    if (cell.process?.kind === CellProcessKind.Mining) {
        return miningSettlement(cell, maturedBatches, effects, config, useHubShelf);
    }
    const fitByRoom = fitBatchesByRoom(effects, cell.resources, config, useHubShelf);
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
    stalled: boolean,
): ProcessProgress {
    const isFinished = processSettlement.settledBatches >= batchSchedule.remainingBatches || processSettlement.depleted;
    return {
        completedBatches: process.claimedBatches + processSettlement.settledBatches,
        claimableBatches: processSettlement.settledBatches,
        isFinished,
        endsAtSec: batchSchedule.endsAtSec,
        nextBatchAtSec: isFinished || stalled ? null : batchSchedule.nextBatchAtSec,
    };
}

export function deriveCellProcess(
    process: RawCellProcessView | null,
    resources: Array<CellResource>,
    config: ProcessProjectionConfig,
    useHubShelf: boolean,
): CellProcessView | null {
    if (process === null) {
        return null;
    }
    const effects = warehouseEffects(outputs(process, config), resources, config, useHubShelf);
    return {
        ...process,
        stalled: hasRemainingProduction(process, resources) && effects.some((effect) => effect.blocked),
    };
}

export function projectCellProcess(
    cell: Cell,
    serverTime: number,
    config: CellProjectionConfig,
): ProcessProjection | null {
    const process = cell.process;
    if (process === null) {
        return null;
    }
    const useHubShelf = usesHubShelf(cell.building, cell.ready, config);
    const processOutputs = outputs(process, config);
    const effects = warehouseEffects(processOutputs, cell.resources, config, useHubShelf);
    const batchSchedule = schedule(process, serverTime);
    const stalled = hasRemainingProduction(process, cell.resources) && effects.some((effect) => effect.blocked);
    const processSettlement = settlement(cell, batchSchedule.maturedBatches, effects, config, useHubShelf);
    return {
        stalled,
        warehouseEffects: effects,
        progress: progress(process, batchSchedule, processSettlement, stalled),
        settlement: processSettlement,
    };
}
