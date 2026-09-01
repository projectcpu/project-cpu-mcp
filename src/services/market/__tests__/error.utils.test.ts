import { describe, expect, it } from 'vitest';

import {
    MARKET_BACKOFF_BASE_MS,
    MARKET_BACKOFF_FACTOR,
    MARKET_BACKOFF_MAX_MS,
    MARKET_RETRY_BUDGET_MS,
    MS_PER_SECOND,
} from '../constants.js';
import {
    isRetryableMarketCode,
    marketBackoffDelayMs,
    marketErrorMessage,
    rateLimitDelayMs,
    retryAfterSecondsFrom,
    toMarketErrorCode,
} from '../error.utils.js';
import { MarketActionStage, MarketErrorCode } from '../types.js';

function headersWith(retryAfter: string): Headers {
    return new Headers({ 'retry-after': retryAfter });
}

describe('market retry constants', () => {
    it('keeps the one automatic-wait budget at 60 seconds', () => {
        expect(MARKET_RETRY_BUDGET_MS).toBe(60_000);
        expect(MS_PER_SECOND).toBe(1_000);
    });

    it('keeps the bounded backoff between 250 milliseconds and 4 seconds', () => {
        expect(MARKET_BACKOFF_BASE_MS).toBe(250);
        expect(MARKET_BACKOFF_FACTOR).toBe(2);
        expect(MARKET_BACKOFF_MAX_MS).toBe(4_000);
    });
});

describe('retryAfterSecondsFrom', () => {
    it('reads a whole number of seconds off the header', () => {
        expect(retryAfterSecondsFrom(headersWith('30'))).toBe(30);
        expect(retryAfterSecondsFrom(headersWith(' 30 '))).toBe(30);
    });

    it('reports no delay when the header is missing, absent or unusable', () => {
        expect(retryAfterSecondsFrom(null)).toBeNull();
        expect(retryAfterSecondsFrom(new Headers())).toBeNull();
        expect(retryAfterSecondsFrom(headersWith('soon'))).toBeNull();
        expect(retryAfterSecondsFrom(headersWith('Wed, 21 Oct 2015 07:28:00 GMT'))).toBeNull();
        expect(retryAfterSecondsFrom(headersWith('-5'))).toBeNull();
    });

    it('truncates a sub-second delay to zero, which the honoured delay must not take literally', () => {
        expect(retryAfterSecondsFrom(headersWith('0'))).toBe(0);
        expect(retryAfterSecondsFrom(headersWith('0.5'))).toBe(0);
        expect(retryAfterSecondsFrom(headersWith('0.9'))).toBe(0);
    });
});

describe('rateLimitDelayMs', () => {
    it('never waits less than the bounded backoff, whatever the header says', () => {
        for (const attempt of [1, 2, 3, 4, 5, 6, 20]) {
            expect(rateLimitDelayMs(0, attempt)).toBe(marketBackoffDelayMs(attempt));
            expect(rateLimitDelayMs(0, attempt)).toBeGreaterThanOrEqual(MARKET_BACKOFF_BASE_MS);
            expect(rateLimitDelayMs(null, attempt)).toBe(marketBackoffDelayMs(attempt));
        }
    });

    it('honours a header delay that is longer than the backoff', () => {
        expect(rateLimitDelayMs(5, 1)).toBe(5 * MS_PER_SECOND);
        expect(rateLimitDelayMs(600, 3)).toBe(600 * MS_PER_SECOND);
    });

    it('escalates while a limiter keeps answering with a zero delay', () => {
        expect(rateLimitDelayMs(0, 1)).toBe(250);
        expect(rateLimitDelayMs(0, 2)).toBe(500);
        expect(rateLimitDelayMs(0, 3)).toBe(1_000);
        expect(rateLimitDelayMs(0, 9)).toBe(MARKET_BACKOFF_MAX_MS);
    });
});

describe('marketBackoffDelayMs', () => {
    it('starts at the base delay and is capped', () => {
        expect(marketBackoffDelayMs(1)).toBe(MARKET_BACKOFF_BASE_MS);
        expect(marketBackoffDelayMs(0)).toBe(MARKET_BACKOFF_BASE_MS);
        expect(marketBackoffDelayMs(2)).toBe(MARKET_BACKOFF_BASE_MS * MARKET_BACKOFF_FACTOR);
        expect(marketBackoffDelayMs(100)).toBe(MARKET_BACKOFF_MAX_MS);
    });
});

describe('toMarketErrorCode', () => {
    it('keeps a code the client knows and refuses anything else', () => {
        expect(toMarketErrorCode('upstreamRateLimited')).toBe(MarketErrorCode.UpstreamRateLimited);
        expect(toMarketErrorCode('upstreamUnavailable')).toBe(MarketErrorCode.UpstreamUnavailable);
        expect(toMarketErrorCode('invalidRequest')).toBe(MarketErrorCode.InvalidRequest);
        expect(toMarketErrorCode('staleListing')).toBe(MarketErrorCode.StaleListing);
        expect(toMarketErrorCode('staleOffer')).toBe(MarketErrorCode.StaleOffer);
        expect(toMarketErrorCode('unfulfillable')).toBe(MarketErrorCode.Unfulfillable);
        expect(toMarketErrorCode('notOwner')).toBe(MarketErrorCode.NotOwner);
        expect(toMarketErrorCode('currencyNotConfigured')).toBe(MarketErrorCode.CurrencyNotConfigured);
        expect(toMarketErrorCode('ORDER_UNAVAILABLE')).toBe(MarketErrorCode.OrderUnavailable);
        expect(toMarketErrorCode('somethingElse')).toBeNull();
        expect(toMarketErrorCode('UPSTREAMRATELIMITED')).toBeNull();
        expect(toMarketErrorCode(429)).toBeNull();
        expect(toMarketErrorCode(null)).toBeNull();
    });
});

describe('isRetryableMarketCode', () => {
    it('marks waiting-it-out codes retryable and every terminal code not', () => {
        expect(isRetryableMarketCode(MarketErrorCode.UpstreamRateLimited)).toBe(true);
        expect(isRetryableMarketCode(MarketErrorCode.UpstreamUnavailable)).toBe(true);
        expect(isRetryableMarketCode(MarketErrorCode.PreparedIntentInProgress)).toBe(true);
        expect(isRetryableMarketCode(MarketErrorCode.OutcomeUnknown)).toBe(true);
        expect(isRetryableMarketCode(MarketErrorCode.UnresolvedCapacityFull)).toBe(true);
        expect(isRetryableMarketCode(MarketErrorCode.NetworkFailure)).toBe(true);
        expect(isRetryableMarketCode(MarketErrorCode.ServiceUnavailable)).toBe(true);

        expect(isRetryableMarketCode(MarketErrorCode.UpstreamRejected)).toBe(false);
        expect(isRetryableMarketCode(MarketErrorCode.PreparedIntentFlowMismatch)).toBe(false);
        expect(isRetryableMarketCode(MarketErrorCode.InvalidInput)).toBe(false);
        expect(isRetryableMarketCode(MarketErrorCode.InvalidMarketResponse)).toBe(false);
        expect(isRetryableMarketCode(MarketErrorCode.Unauthorized)).toBe(false);
        expect(isRetryableMarketCode(MarketErrorCode.TransactionReverted)).toBe(false);
        expect(isRetryableMarketCode(MarketErrorCode.MarketRequestFailed)).toBe(false);
    });
});

describe('marketErrorMessage', () => {
    it('says plainly that repeating the call is safe, and never the opposite', () => {
        const message = marketErrorMessage({
            code: MarketErrorCode.UpstreamRateLimited,
            message: 'slow down',
            retryable: true,
            retryAfterSeconds: 30,
            stage: MarketActionStage.Read,
            txHash: null,
        });

        expect(message).toContain('Repeating this exact call is safe.');
        expect(message).not.toContain('unsafe');
        expect(message).not.toContain('will fail the same way');
        expect(message).toContain('[upstreamRateLimited] slow down');
        expect(message).toContain('retryAfterSeconds=30.');
        expect(message).toContain('Failed at stage "read".');
    });

    it('says plainly that repeating a terminal call will fail the same way', () => {
        const message = marketErrorMessage({
            code: MarketErrorCode.OrderUnavailable,
            message: 'gone',
            retryable: false,
            retryAfterSeconds: null,
            stage: null,
            txHash: `0x${'d'.repeat(64)}`,
        });

        expect(message).toContain('Repeating this exact call will fail the same way');
        expect(message).not.toContain('is safe');
        expect(message).not.toContain('retryAfterSeconds');
        expect(message).not.toContain('Failed at stage');
        expect(message).toContain(`Confirmed transaction 0x${'d'.repeat(64)}.`);
    });
});
