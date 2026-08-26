import { MARKET_CELL_PATH } from './constants.js';
import { MarketError } from './error.js';
import {
    cellMarketSnapshotSchema,
    cellTokenIdSchema,
    MarketActionStage,
    MarketErrorCode,
    MarketOfferKind,
    type CellMarketSnapshot,
    type IMarketApiClient,
    type IMarketService,
    type MarketServiceOptions,
} from './types.js';
import type { ILogger } from '../../logger/types.js';

export class MarketService implements IMarketService {
    private readonly client: IMarketApiClient;
    private readonly logger: ILogger;

    constructor(options: MarketServiceOptions) {
        this.client = options.client;
        this.logger = options.logger;
    }

    async getCellMarket(tokenId: string): Promise<CellMarketSnapshot> {
        const canonical = this.requireCanonicalTokenId(tokenId);

        this.logger.info('reading the Cell marketplace snapshot', { tokenId: canonical });

        const snapshot = await this.client.send({
            path: `${MARKET_CELL_PATH}/${canonical}`,
            method: 'GET',
            body: null,
            schema: cellMarketSnapshotSchema,
            stage: MarketActionStage.Read,
            label: `The marketplace snapshot for Cell ${canonical}`,
        });

        return this.requireSnapshotOfCell(canonical, snapshot);
    }

    private requireSnapshotOfCell(canonical: string, snapshot: CellMarketSnapshot): CellMarketSnapshot {
        if (snapshot.tokenId !== canonical) {
            throw this.wrongCell(canonical, `it describes Cell ${snapshot.tokenId}`);
        }

        const listing = snapshot.bestListing;
        if (listing !== null && listing.tokenId !== canonical) {
            throw this.wrongCell(canonical, `its best listing sells Cell ${listing.tokenId}`);
        }

        const offer = snapshot.bestOffer;
        if (offer !== null && offer.tokenId !== null && offer.tokenId !== canonical) {
            throw this.wrongCell(canonical, `its best offer bids on Cell ${offer.tokenId}`);
        }
        if (offer !== null && offer.kind === MarketOfferKind.Item && offer.tokenId === null) {
            throw this.wrongCell(canonical, 'its best offer is an item offer bound to no Cell at all');
        }

        return snapshot;
    }

    private wrongCell(canonical: string, detail: string): MarketError {
        this.logger.error('marketplace snapshot does not describe the requested Cell', { tokenId: canonical, detail });

        return new MarketError({
            code: MarketErrorCode.InvalidMarketResponse,
            message:
                `The marketplace snapshot for Cell ${canonical} cannot be trusted: ${detail}. ` +
                'Trading on it would target the wrong Cell.',
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Read,
            txHash: null,
        });
    }

    private requireCanonicalTokenId(tokenId: string): string {
        const parsed = cellTokenIdSchema.safeParse(tokenId);
        if (parsed.success) {
            return parsed.data;
        }

        throw new MarketError({
            code: MarketErrorCode.InvalidInput,
            message:
                `"${tokenId}" is not a canonical Cell token id. Pass a decimal integer with no leading zeroes ` +
                'so that one Cell keeps one identity.',
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Read,
            txHash: null,
        });
    }
}
