import { z } from 'zod';

import { MAX_TOKEN_ID, MIN_TOKEN_ID } from './constants.js';

export interface CellCoord {
    face: number;
    i: number;
    j: number;
}

export const tokenIdSchema = z.coerce.number().int().min(MIN_TOKEN_ID).max(MAX_TOKEN_ID);
