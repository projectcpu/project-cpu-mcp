import { marketErrorMessage } from './error.utils.js';
import type { MarketActionStage, MarketErrorCode, MarketErrorOptions } from './types.js';

export class MarketError extends Error {
    readonly code: MarketErrorCode;
    readonly retryable: boolean;
    readonly retryAfterSeconds: number | null;
    readonly stage: MarketActionStage | null;
    readonly txHash: string | null;

    constructor(options: MarketErrorOptions) {
        super(marketErrorMessage(options));
        this.name = 'MarketError';
        this.code = options.code;
        this.retryable = options.retryable;
        this.retryAfterSeconds = options.retryAfterSeconds;
        this.stage = options.stage;
        this.txHash = options.txHash;
    }
}
