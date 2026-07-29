import { formatDistanceStrict } from 'date-fns';

import type { CraftStackView, RecipeView } from '../../api/types.js';
import type { CraftClaimResult, CraftStartResult, CraftStatusResult } from '../../services/types.js';
import { formatStacks as formatStackList, type ResourceNames } from '../../utils/format.utils.js';

function formatStacks(stacks: Array<CraftStackView>, resources: ResourceNames): string {
    return stacks.length === 0 ? 'nothing' : formatStackList(resources, stacks, ' + ');
}

function formatCost(costCpu: string): string {
    return costCpu === '0' ? 'free' : `${costCpu} $CPU/batch`;
}

export function summarizeRecipes(recipes: Array<RecipeView>, resources: ResourceNames): string {
    if (recipes.length === 0) {
        return 'No craft recipes available.';
    }
    return recipes
        .map(
            (r) =>
                `${r.name} (${r.id}): ${formatStacks(r.inputs, resources)} → ${formatStacks(r.outputs, resources)}, ` +
                `~${formatDistanceStrict(0, r.durationSec * 1000)}/batch, ${formatCost(r.costCpu)}`,
        )
        .join('\n');
}

function describeCraftCost(r: CraftStartResult): string {
    const base = r.costCpu === '0' ? 'free' : `${r.costCpu} $CPU`;
    if (!r.opex.served) {
        return `${base}, plus a per-recipe opex the chain adds on top (not priced here)`;
    }
    if (r.opex.costCpu === '0') {
        return base;
    }
    return `${r.costCpu} $CPU base + ${r.opex.costCpu} $CPU opex = ${r.totalCpu} $CPU`;
}

export function summarizeCraftStart(r: CraftStartResult): string {
    const approve = r.approveTxHash !== null ? `approve tx ${r.approveTxHash}, ` : '';
    const cost = describeCraftCost(r);
    return (
        `Craft started on cell ${r.tokenId}: ${r.batches}× ${r.recipeId} (${cost}). ${approve}craft tx ${r.txHash} ` +
        `confirmed in block ${r.blockNumber}. Batches mature over time — check get_craft_status ${r.tokenId} and bank ` +
        `matured ones with claim_craft ${r.tokenId}.`
    );
}

export function summarizeCraftStatus(s: CraftStatusResult): string {
    if (!s.active) {
        return `Cell ${s.tokenId} has no active craft.`;
    }
    const claimable = s.claimableBatches > 0 ? `, ${s.claimableBatches} claimable now` : '';
    const stalled =
        s.stalled && !s.isFinished
            ? ` — STALLED: an output box (resources ${s.blockedResourceIds.join(', ')}) has room for less than one ` +
              `whole batch, so nothing settles and the wait is burnt; offload a blocked output to resume.`
            : '';
    const finished = s.isFinished ? ' Run FINISHED — claim to bank it and free the cell.' : '';
    return (
        `Cell ${s.tokenId} crafting ${s.recipeId}: ${s.completedBatches}/${s.batches} batches done ` +
        `(${s.claimedBatches} already claimed)${claimable}.${finished}${stalled}`
    );
}

export function summarizeCraftClaim(r: CraftClaimResult, resources: ResourceNames): string {
    if (r.outputs.length === 0) {
        return `Nothing matured yet to claim on cell ${r.tokenId} (tx ${r.txHash}).`;
    }
    const outs = formatStackList(resources, r.outputs, ' + ');
    return `Claimed ${r.batches} batch(es) → ${outs} on cell ${r.tokenId}: tx ${r.txHash} confirmed in block ${r.blockNumber}.`;
}
