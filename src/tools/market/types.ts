import type { ZodRawShape } from 'zod';

import { cellTokenIdSchema } from '../../services/market/types.js';
import type { ToolHandler } from '../types.js';

export interface MarketToolDefinition {
    name: string;
    description: string;
    inputSchema: ZodRawShape;
    handler: ToolHandler;
}

export const getCellMarketInputSchema = {
    tokenId: cellTokenIdSchema.describe(
        'The Cell token id to inspect on the public NFT marketplace, as a decimal string with no leading zeroes ' +
            '(e.g. "1234", never "01234"). One Cell per call.',
    ),
};
