import { MARKET_CELL_PATH } from './constants.js';
import { MarketError } from './error.js';
import {
    cellMarketSnapshotSchema,
    cellTokenIdSchema,
    MarketActionStage,
    MarketErrorCode,
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

        return this.client.send({
            path: `${MARKET_CELL_PATH}/${canonical}`,
            method: 'GET',
            body: null,
            schema: cellMarketSnapshotSchema,
            stage: MarketActionStage.Read,
            label: `The marketplace snapshot for Cell ${canonical}`,
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
