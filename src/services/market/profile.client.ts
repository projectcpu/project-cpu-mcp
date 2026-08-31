import type { z } from 'zod';

import { MARKET_MY_LISTINGS_PATH, MARKET_MY_OFFERS_PATH, MARKET_MY_OFFERS_RECEIVED_PATH } from './constants.js';
import { MarketError } from './error.js';
import {
    marketListingPageResponseSchema,
    marketOfferPageResponseSchema,
    type IMarketProfileReader,
    type MarketListingPage,
    type MarketOfferPage,
    type MarketProfileClientOptions,
} from './profile.schemas.js';
import { pagePath } from './profile.utils.js';
import { cursorSchema, MarketActionStage, MarketErrorCode, type IMarketApiClient } from './types.js';
import type { ILogger } from '../../logger/types.js';

export class MarketProfileClient implements IMarketProfileReader {
    private readonly client: IMarketApiClient;
    private readonly chainId: number;
    private readonly logger: ILogger;

    constructor(options: MarketProfileClientOptions) {
        this.client = options.client;
        this.chainId = options.chainId;
        this.logger = options.logger;
    }

    async getMyListings(cursor: string | null): Promise<MarketListingPage> {
        return this.readPage(
            MARKET_MY_LISTINGS_PATH,
            cursor,
            marketListingPageResponseSchema(this.chainId),
            'your Cell listings',
        );
    }

    async getMyOffers(cursor: string | null): Promise<MarketOfferPage> {
        return this.readPage(
            MARKET_MY_OFFERS_PATH,
            cursor,
            marketOfferPageResponseSchema(this.chainId),
            'the offers you made',
        );
    }

    async getMyOffersReceived(cursor: string | null): Promise<MarketOfferPage> {
        return this.readPage(
            MARKET_MY_OFFERS_RECEIVED_PATH,
            cursor,
            marketOfferPageResponseSchema(this.chainId),
            'the offers standing on your Cells',
        );
    }

    private async readPage<TSchema extends z.ZodTypeAny>(
        basePath: string,
        cursor: string | null,
        schema: TSchema,
        subject: string,
    ): Promise<z.infer<TSchema>> {
        const requested = this.requireUsableCursor(cursor, subject);

        this.logger.info('reading a marketplace page for the authenticated wallet', {
            path: basePath,
            paged: requested !== null,
        });

        return this.client.send({
            path: pagePath(basePath, requested),
            method: 'GET',
            body: null,
            schema,
            stage: MarketActionStage.Read,
            label: `The marketplace page for ${subject}`,
        });
    }

    private requireUsableCursor(cursor: string | null, subject: string): string | null {
        if (cursor === null || cursorSchema.safeParse(cursor).success) {
            return cursor;
        }

        throw new MarketError({
            code: MarketErrorCode.InvalidInput,
            message:
                `"${cursor}" is not a page cursor for ${subject}. Pass the exact nextCursor from the previous ` +
                'page, or null to start at the first page.',
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Read,
            txHash: null,
        });
    }
}
