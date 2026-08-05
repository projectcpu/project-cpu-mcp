import type { DemolishState } from '../../../map/types.js';
import { formatUnixSeconds } from '../../../utils/format.utils.js';

// The end of the cooldown is always known; what was demolished and when it began are not, so they are appended
// only when they actually arrived — an unchanged header is how "unknown" reads, rather than a run of empty labels.
export function demolishNote(demolish: DemolishState | null): string {
    if (demolish === null) {
        return '';
    }
    const details = [
        demolish.buildingType === null ? null : `demolishing ${demolish.buildingType}`,
        demolish.startAt === null ? null : `started ${formatUnixSeconds(demolish.startAt)}`,
    ].filter((detail): detail is string => detail !== null);
    const tail = details.length === 0 ? '' : ` · ${details.join(', ')}`;
    return ` · demolition cooldown until ${formatUnixSeconds(demolish.finishAt)} (no rebuild yet)${tail}`;
}
