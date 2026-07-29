export const DEFAULT_RETRY_OPTIONS = {
    maxAttempts: 3,
    baseDelayMs: 250,
    maxDelayMs: 4_000,
    factor: 2,
} as const;

export const RETRYABLE_ERROR_PATTERNS = [
    'timeout',
    'timed out',
    'etimedout',
    'econnreset',
    'econnrefused',
    'enotfound',
    'eai_again',
    'socket hang up',
    'network error',
    'fetch failed',
    'rate limit',
    'too many requests',
    'service unavailable',
    'bad gateway',
    'gateway timeout',
] as const;

export const REVERT_ERROR_NAMES = [
    'ContractFunctionRevertedError',
    'ContractFunctionExecutionError',
    'ExecutionRevertedError',
    'RawContractError',
    'InvalidInputRpcError',
] as const;

export const RETRYABLE_HTTP_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
