import { MarketErrorCode } from './types.js';

export const MARKET_BASE_PATH = '/api/v1/market';

export const MARKET_CELL_PATH = `${MARKET_BASE_PATH}/cells`;

export const MARKET_RETRY_BUDGET_MS = 60_000;

export const MS_PER_SECOND = 1_000;

export const MARKET_BACKOFF_BASE_MS = 250;

export const MARKET_BACKOFF_FACTOR = 2;

export const MARKET_BACKOFF_MAX_MS = 4_000;

export const HTTP_INTERNAL_SERVER_ERROR = 500;

export const RETRYABLE_MARKET_ERROR_CODES: ReadonlySet<MarketErrorCode> = new Set([
    MarketErrorCode.UpstreamRateLimited,
    MarketErrorCode.PreparedIntentInProgress,
    MarketErrorCode.OutcomeUnknown,
    MarketErrorCode.UnresolvedCapacityFull,
    MarketErrorCode.NetworkFailure,
    MarketErrorCode.ServiceUnavailable,
]);
