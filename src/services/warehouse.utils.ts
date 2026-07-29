import type { CraftStackView } from '../api/types.js';
import type { Cell } from '../map/types.js';
import { resourceName, type ResourceNames } from '../utils/format.utils.js';

// build, demolish, and craft all debit refined inputs from a cell's liquid warehouse balance on-chain; surface
// a clear shortfall before spending gas instead of letting the tx revert with an opaque insufficient-balance
// error. `state === null` (map not synced) skips the check — the chain stays the arbiter. `required` amounts are
// the fully-resolved totals (e.g. a recipe's per-batch inputs already multiplied by the batch count).
export function assertWarehouseHas(
    resources: ResourceNames,
    state: Cell | null,
    required: Array<CraftStackView>,
    tokenId: string,
    action: string,
): void {
    if (state === null) {
        return;
    }
    for (const req of required) {
        const held = state.resources.find((r) => r.resourceId === req.resourceId)?.balance ?? '0';
        if (BigInt(held) < BigInt(req.amount)) {
            const name = resourceName(resources, req.resourceId);
            throw new Error(
                `Cell ${tokenId} needs ${req.amount} ${name} in its warehouse to ${action}, but holds ${held} ` +
                    `(map may be stale — retry shortly).`,
            );
        }
    }
}
