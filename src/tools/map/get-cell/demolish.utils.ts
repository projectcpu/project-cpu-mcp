import type { ActiveDemolition } from '../../../map/types.js';
import { formatUnixSeconds } from '../../../utils/format.utils.js';

// Details are appended only once they arrive: an unchanged header is how "unknown" reads, rather than a run of
// empty labels on every locked cell.
export function demolishNote(demolish: ActiveDemolition | null): string {
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
