import { CellProcessKind, type ProcessOutput, type RawCellProcessView } from './types.js';

export function processOutputs(
    process: RawCellProcessView,
    craftOutputsByRecipe: Record<string, Array<ProcessOutput>>,
): Array<ProcessOutput> {
    if (process.kind === CellProcessKind.Mining) {
        return [{ resourceId: process.resource, amount: process.yieldPerCycle }];
    }
    return craftOutputsByRecipe[process.recipeId] ?? [];
}

export interface BatchScheduleInput {
    durationSec: number;
    batches: number;
    claimedBatches: number;
    startAtSec: number;
    nowSec: number;
}

export interface BatchSchedule {
    maturedBatches: number;
    remainingBatches: number;
    endsAtSec: number;
    nextBatchAtSec: number | null;
}

export function computeBatchSchedule({
    durationSec,
    batches,
    claimedBatches,
    startAtSec,
    nowSec,
}: BatchScheduleInput): BatchSchedule {
    const remainingBatches = Math.max(0, batches - claimedBatches);
    const elapsedSec = Math.max(0, nowSec - startAtSec);
    const elapsedBatches = durationSec > 0 ? Math.floor(elapsedSec / durationSec) : 0;
    const maturedBatches = Math.min(elapsedBatches, remainingBatches);

    return {
        maturedBatches,
        remainingBatches,
        endsAtSec: startAtSec + remainingBatches * durationSec,
        nextBatchAtSec: maturedBatches >= remainingBatches ? null : startAtSec + (maturedBatches + 1) * durationSec,
    };
}

export interface ProcessProgressInput {
    schedule: BatchSchedule;
    claimedBatches: number;
    settledBatches: number;
    depleted: boolean;
    stalled: boolean;
}

export interface ProcessProgress {
    completedBatches: number;
    claimableBatches: number;
    isFinished: boolean;
    endsAtSec: number;
    nextBatchAtSec: number | null;
}

export function toProcessProgress({
    schedule,
    claimedBatches,
    settledBatches,
    depleted,
    stalled,
}: ProcessProgressInput): ProcessProgress {
    const isFinished = settledBatches >= schedule.remainingBatches || depleted;

    return {
        completedBatches: claimedBatches + settledBatches,
        claimableBatches: settledBatches,
        isFinished,
        endsAtSec: schedule.endsAtSec,
        nextBatchAtSec: isFinished || stalled ? null : schedule.nextBatchAtSec,
    };
}
