import type { ActiveDemolition } from '../../../map/types.js';
import { formatUnixSeconds } from '../../../utils/format.utils.js';

// Details are appended only once they arrive: silence is how "unknown" reads, rather than a run of empty
// details on every locked cell.
export function demolishNote(demolish: ActiveDemolition | null): string | null {
    if (demolish === null) {
        return null;
    }
    const details = [
        demolish.buildingType === null ? null : `demolishing ${demolish.buildingType}`,
        demolish.startAt === null ? null : `started ${formatUnixSeconds(demolish.startAt)}`,
    ].filter((detail): detail is string => detail !== null);
    const tail = details.length === 0 ? '' : `, ${details.join(', ')}`;
    return `rebuild locked by a demolition cooldown until ${formatUnixSeconds(demolish.finishAt)}${tail}`;
}
