import type { ZodRawShape, ZodType } from 'zod';

import { cursorSchema, marketLookupTokenIdSchema } from '../../services/market/types.js';
import type { ToolHandler } from '../types.js';

export interface MarketToolDefinition {
    name: string;
    description: string;
    inputSchema: ZodRawShape;
    outputSchema: ZodType;
    handler: ToolHandler;
}

export const getCellMarketInputSchema = {
    tokenId: marketLookupTokenIdSchema.describe(
        'The Cell token id to inspect on the public NFT marketplace, as a decimal string with no leading zeroes ' +
            '(e.g. "0" or "1234", never "01234"). One Cell per call.',
    ),
};

export const marketPageInputSchema = {
    cursor: cursorSchema
        .nullable()
        .default(null)
        .describe(
            'Page cursor. Omit it (or pass null) for the first page, then pass back the exact `nextCursor` the ' +
                'previous page returned. There is no page-size input and no wallet input: the page always ' +
                'describes the authenticated wallet.',
        ),
};
