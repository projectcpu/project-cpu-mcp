import type { z } from 'zod';

import type { IMarketApiClient, MarketRequestInput } from './types.js';

export interface IMarketSingleShotClient extends IMarketApiClient {
    sendOnce<TSchema extends z.ZodTypeAny>(input: MarketRequestInput<TSchema>): Promise<z.infer<TSchema>>;
}
