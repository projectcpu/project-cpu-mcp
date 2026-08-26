import { MarketErrorCode } from './types.js';

export const MARKET_BASE_PATH = '/api/v1/market';

export const MARKET_CELL_PATH = `${MARKET_BASE_PATH}/cells`;

export const MARKET_MY_LISTINGS_PATH = `${MARKET_BASE_PATH}/me/listings`;

export const MARKET_MY_OFFERS_PATH = `${MARKET_BASE_PATH}/me/offers`;

export const MARKET_MY_OFFERS_RECEIVED_PATH = `${MARKET_BASE_PATH}/me/offers-received`;

export const MARKET_CURSOR_PARAM = 'cursor';

export const MARKET_PAGE_SIZE_HINT = 50;

export const MARKET_RETRY_BUDGET_MS = 60_000;

export const MS_PER_SECOND = 1_000;

export const MARKET_BACKOFF_BASE_MS = 250;

export const MARKET_BACKOFF_FACTOR = 2;

export const MARKET_BACKOFF_MAX_MS = 4_000;

export const HTTP_INTERNAL_SERVER_ERROR = 500;

export const HTTP_SUCCESS_MIN = 200;

export const HTTP_SUCCESS_MAX = 299;

export const PROVEN_UNPUBLISHED_MARKET_ERROR_CODES: ReadonlySet<MarketErrorCode> = new Set([
    MarketErrorCode.Unauthorized,
    MarketErrorCode.InvalidInput,
    MarketErrorCode.SignatureMismatch,
    MarketErrorCode.PreparedIntentFlowMismatch,
    MarketErrorCode.PreparedIntentExpired,
]);

export const RETRYABLE_MARKET_ERROR_CODES: ReadonlySet<MarketErrorCode> = new Set([
    MarketErrorCode.UpstreamRateLimited,
    MarketErrorCode.PreparedIntentInProgress,
    MarketErrorCode.OutcomeUnknown,
    MarketErrorCode.UnresolvedCapacityFull,
    MarketErrorCode.NetworkFailure,
    MarketErrorCode.ServiceUnavailable,
]);
