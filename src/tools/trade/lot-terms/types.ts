import { z } from 'zod';

import { tokenIdSchema } from '../../../geometry/types.js';

export const getLotTermsInputSchema = {
    hubTokenId: tokenIdSchema.describe('The Hub cell token id you want to list on.'),
    resourceId: z.number().int().describe('Resource type id you want to list there.'),
};
