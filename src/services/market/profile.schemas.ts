import type { z } from 'zod';

import { marketListingSchema, marketOfferSchema, marketPageSchema } from './types.js';
import type { IMarketApiClient } from './types.js';
import type { ILogger } from '../../logger/types.js';

export const marketListingPageSchema = marketPageSchema(marketListingSchema);

export const marketOfferPageSchema = marketPageSchema(marketOfferSchema);

export type MarketListingPage = z.infer<typeof marketListingPageSchema>;

export type MarketOfferPage = z.infer<typeof marketOfferPageSchema>;

export interface MarketProfileClientOptions {
    client: IMarketApiClient;
    logger: ILogger;
}

export interface IMarketProfileReader {
    getMyListings(cursor: string | null): Promise<MarketListingPage>;
    getMyOffers(cursor: string | null): Promise<MarketOfferPage>;
    getMyOffersReceived(cursor: string | null): Promise<MarketOfferPage>;
}
