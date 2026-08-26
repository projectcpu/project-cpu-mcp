import {
    HTTP_SUCCESS_MAX,
    HTTP_SUCCESS_MIN,
    MARKET_BACKOFF_BASE_MS,
    MARKET_BACKOFF_FACTOR,
    MARKET_BACKOFF_MAX_MS,
    MS_PER_SECOND,
    RETRYABLE_MARKET_ERROR_CODES,
} from './constants.js';
import { MarketErrorCode, MarketWaitRefusal, type MarketErrorOptions } from './types.js';

export function toMarketErrorCode(value: unknown): MarketErrorCode | null {
    if (typeof value !== 'string') {
        return null;
    }
    const known = Object.values(MarketErrorCode).find((code) => code === value);
    return known ?? null;
}

export function isMarketSuccessStatus(status: number): boolean {
    return status >= HTTP_SUCCESS_MIN && status <= HTTP_SUCCESS_MAX;
}

export function isRetryableMarketCode(code: MarketErrorCode): boolean {
    return RETRYABLE_MARKET_ERROR_CODES.has(code);
}

export function retryAfterSecondsFrom(headers: Headers | null): number | null {
    const raw = headers?.get('retry-after') ?? null;
    if (raw === null) {
        return null;
    }
    const seconds = Number.parseInt(raw.trim(), 10);
    return Number.isInteger(seconds) && seconds >= 0 ? seconds : null;
}

export function marketBackoffDelayMs(attempt: number): number {
    const delay = MARKET_BACKOFF_BASE_MS * MARKET_BACKOFF_FACTOR ** Math.max(0, attempt - 1);
    return Math.min(MARKET_BACKOFF_MAX_MS, delay);
}

export function rateLimitDelayMs(retryAfterSeconds: number | null, attempt: number): number {
    const honoured = retryAfterSeconds === null ? 0 : retryAfterSeconds * MS_PER_SECOND;
    return Math.max(marketBackoffDelayMs(attempt), honoured);
}

export function waitRefusalNote(refusal: MarketWaitRefusal, delayMs: number): string {
    const seconds = Math.ceil(delayMs / MS_PER_SECOND);

    if (refusal === MarketWaitRefusal.DeadlineWouldPass) {
        return (
            `Waiting ${seconds}s would carry this call past the deadline of the order it prepared, so nothing ` +
            'was waited out and nothing was sent.'
        );
    }

    return 'The automatic wait budget for this tool call is spent — invoke the same tool again later.';
}

export function marketErrorMessage(options: MarketErrorOptions): string {
    const parts = [`[${options.code}] ${options.message}`];
    parts.push(
        options.retryable
            ? 'Repeating this exact call is safe.'
            : 'Repeating this exact call will fail the same way — change the input or pick another order.',
    );
    if (options.retryAfterSeconds !== null) {
        parts.push(`retryAfterSeconds=${options.retryAfterSeconds}.`);
    }
    if (options.stage !== null) {
        parts.push(`Failed at stage "${options.stage}".`);
    }
    if (options.txHash !== null) {
        parts.push(`Confirmed transaction ${options.txHash}.`);
    }
    return parts.join(' ');
}
