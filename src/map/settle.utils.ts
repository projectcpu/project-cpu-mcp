import { BASIS_POINTS } from './constants.js';
import { computeBatchSchedule, processOutputs, toProcessProgress, type ProcessProgress } from './process.utils.js';
import { fitBatchesByRoom } from './storage.utils.js';
import { CellProcessKind, type Cell, type CellProcessView, type CellResource, type ProcessOutput } from './types.js';

export function takePerCycle(creditPerCycle: number, extractionShareBp: number): number {
    return Math.ceil((creditPerCycle * BASIS_POINTS) / extractionShareBp);
}

export interface Settlement {
    settledBatches: number;
    minedUnits: bigint;
    drainedUnits: bigint;
    depleted: boolean;
}

interface MiningSettleInput {
    resourceId: number;
    yieldPerCycle: number;
    takePerCycle: number;
    maturedBatches: number;
    depositRemaining: bigint;
    resources: ReadonlyArray<CellResource>;
}

function settleMining({
    resourceId,
    yieldPerCycle,
    takePerCycle,
    maturedBatches,
    depositRemaining,
    resources,
}: MiningSettleInput): Settlement {
    const take = BigInt(takePerCycle);
    const fitByRoom = fitBatchesByRoom([{ resourceId, amount: yieldPerCycle }], resources);
    const fitByDeposit = Number((depositRemaining + take - 1n) / take);

    const settledBatches = Math.min(maturedBatches, fitByRoom ?? maturedBatches, fitByDeposit);
    const wouldDrain = BigInt(settledBatches) * take;
    const drainedUnits = wouldDrain > depositRemaining ? depositRemaining : wouldDrain;

    return {
        settledBatches,
        drainedUnits,
        minedUnits: (drainedUnits * BigInt(yieldPerCycle)) / take,
        depleted: depositRemaining - drainedUnits === 0n,
    };
}

interface CraftSettleInput {
    outputs: ReadonlyArray<ProcessOutput>;
    maturedBatches: number;
    resources: ReadonlyArray<CellResource>;
}

function settleCraft({ outputs, maturedBatches, resources }: CraftSettleInput): Settlement {
    const fitByRoom = fitBatchesByRoom(outputs, resources);

    return {
        settledBatches: Math.min(maturedBatches, fitByRoom ?? maturedBatches),
        minedUnits: 0n,
        drainedUnits: 0n,
        depleted: false,
    };
}

export interface SettleConfig {
    craftOutputsByRecipe: Record<string, Array<ProcessOutput>>;
    extractionShareBpByBuilding: Record<string, number>;
}

export function settleCell(cell: Cell, maturedBatches: number, config: SettleConfig): Settlement {
    const process = cell.process;
    if (process === null) {
        return { settledBatches: 0, minedUnits: 0n, drainedUnits: 0n, depleted: false };
    }
    const outputs = processOutputs(process, config.craftOutputsByRecipe);
    if (process.kind !== CellProcessKind.Mining) {
        return settleCraft({ outputs, maturedBatches, resources: cell.resources });
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

    return settleMining({
        resourceId: process.resource,
        yieldPerCycle: process.yieldPerCycle,
        takePerCycle: takePerCycle(process.yieldPerCycle, extractionShareBp),
        maturedBatches,
        depositRemaining: BigInt(cell.resources.find((r) => r.resourceId === process.resource)?.deposit ?? '0'),
        resources: cell.resources,
    });
}

export interface CellProcessProgress {
    progress: ProcessProgress;
    settlement: Settlement;
}

export function cellProcessProgress(
    cell: Cell,
    process: CellProcessView,
    serverTime: number,
    config: SettleConfig,
): CellProcessProgress {
    const schedule = computeBatchSchedule({
        durationSec: process.durationSec,
        batches: process.batches,
        claimedBatches: process.claimedBatches,
        startAtSec: process.startAt,
        nowSec: serverTime,
    });
    const settlement = settleCell(cell, schedule.maturedBatches, config);

    return {
        progress: toProcessProgress({
            schedule,
            claimedBatches: process.claimedBatches,
            settledBatches: settlement.settledBatches,
            depleted: settlement.depleted,
            stalled: process.stalled,
        }),
        settlement,
    };
}
