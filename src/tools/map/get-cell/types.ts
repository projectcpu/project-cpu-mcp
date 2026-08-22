import { tokenIdSchema } from '../../../geometry/types.js';
import type { ActiveDemolition, CellInspection } from '../../../map/types.js';
import type { ResourceNames } from '../../../utils/format.utils.js';

export const getCellInputSchema = {
    tokenId: tokenIdSchema.transform(String).describe('The cell tokenId to inspect.'),
};

export interface CellOverviewInput {
    inspection: CellInspection;
    demolish: ActiveDemolition | null;
    serverTime: number;
    walletAddress: string | null;
    resources: ResourceNames;
}
