import { formatDistanceStrict } from 'date-fns';

import type { MiningClaimResult, MiningStatusResult, StartMiningResult } from '../../services/types.js';
import { resourceLabel, type ResourceNames } from '../../utils/format.utils.js';

export function summarizeMiningStart(r: StartMiningResult, resources: ResourceNames): string {
    const job =
        r.yieldPerCycle !== null && r.durationSec !== null && r.batches !== null
            ? ` ${r.batches} cycle${r.batches === 1 ? '' : 's'} of ${r.yieldPerCycle} every ` +
              `${formatDistanceStrict(0, r.durationSec * 1000)}`
            : '';
    return (
        `Started mining ${resourceLabel(resources, r.targetResourceId)}${job} on cell ${r.tokenId}: ` +
        `tx ${r.txHash} confirmed in block ${r.blockNumber}. The job ends itself once those cycles are done ` +
        `(or the deposit runs out) — there is no cancel. Track it with cpu_get_mining_status ${r.tokenId} and ` +
        `bank matured cycles with cpu_claim_mining.`
    );
}

export function summarizeMiningStatus(s: MiningStatusResult, resources: ResourceNames): string {
    if (!s.active || s.targetResourceId === null) {
        return `Cell ${s.tokenId} has no active mining (no extractor, or its last job ended).`;
    }
    const cycle =
        s.yieldPerCycle !== null && s.durationSec !== null
            ? `${s.yieldPerCycle} per ${formatDistanceStrict(0, s.durationSec * 1000)} cycle. `
            : '';
    const schedule = `${s.completedBatches}/${s.batches} cycles done`;
    const next =
        s.nextBatchAtSec !== null
            ? `, next in ${formatDistanceStrict(0, Math.max(0, s.nextBatchAtSec - s.serverTime) * 1000)}`
            : '';
    const finished = s.isFinished
        ? ` Job FINISHED — claim to bank it and free the cell for its next job or a craft.`
        : '';
    const depleted = s.depositRemaining === '0' ? ' Deposit depleted.' : '';
    const stalled =
        s.stalled && !s.isFinished
            ? ` STALLED: the warehouse (${s.warehouseUsed}/${s.warehouseCap}) has room for less than one cycle, ` +
              `so nothing settles and the wait is burnt; offload to resume.`
            : '';
    return (
        `Cell ${s.tokenId} mining ${resourceLabel(resources, s.targetResourceId)}: ${cycle}` +
        `${s.claimable} claimable now (${s.claimableBatches} cycle${s.claimableBatches === 1 ? '' : 's'}, ` +
        `${schedule})${next}. ${s.depositRemaining} left in deposit.${finished}${depleted}${stalled}`
    );
}

export function summarizeMiningClaim(r: MiningClaimResult, resources: ResourceNames): string {
    const claimed = BigInt(r.claimedAmount);
    if (claimed > 0n && r.resourceId !== null) {
        return (
            `Claimed ${r.claimedAmount} ${resourceLabel(resources, r.resourceId)} from cell ${r.tokenId}: ` +
            `tx ${r.txHash} confirmed in block ${r.blockNumber}.`
        );
    }
    return (
        `Nothing newly matured to claim on cell ${r.tokenId} (tx ${r.txHash}); the job runs until its scheduled ` +
        `cycles are done or the deposit runs out.`
    );
}
