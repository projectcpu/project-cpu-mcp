import type { DestinationCapacityView } from './types.js';
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

/**
 * Whether a shipment of `required` units of one resource still fits in a cell as it stands. The game API's
 * `used` figure already includes liquid balance, incoming transport, and lot reservations, so it is the full
 * occupancy to subtract from the shelf. `emptyStorageCap` carries the config rule when the map has no held row:
 * null is uncapped WCPU, while every other missing cap resolves to zero.
 */
export function assessDestinationCapacity(
    cell: Cell,
    resourceId: number,
    required: bigint,
    emptyStorageCap: bigint | null,
): DestinationCapacityView {
    const storage = cell.resources.find((r) => r.resourceId === resourceId)?.storage ?? null;
    if (storage === null) {
        return emptyStorageCap === null
            ? { fits: true, required: required.toString(), free: null }
            : {
                  fits: required <= emptyStorageCap,
                  required: required.toString(),
                  free: emptyStorageCap.toString(),
              };
    }
    if (storage.cap === null) {
        return { fits: true, required: required.toString(), free: null };
    }
    const taken = BigInt(storage.used);
    const cap = BigInt(storage.cap);
    const free = cap > taken ? cap - taken : 0n;
    return { fits: required <= free, required: required.toString(), free: free.toString() };
}
