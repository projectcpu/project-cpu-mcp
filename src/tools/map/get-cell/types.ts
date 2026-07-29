import { tokenIdSchema } from '../../../geometry/types.js';

export const getCellInputSchema = {
    tokenId: tokenIdSchema.transform(String).describe('The cell tokenId to inspect.'),
};
