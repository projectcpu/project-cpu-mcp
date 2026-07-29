import { BaseError, HttpRequestError, TimeoutError } from 'viem';
import { describe, expect, it } from 'vitest';

import { isRetryableRpcError, withRetry } from '../retry.utils.js';

const fast = { baseDelayMs: 0, maxDelayMs: 0 };

describe('withRetry', () => {
    it('returns the value on the first successful attempt', async () => {
        let calls = 0;
        const result = await withRetry(async () => {
            calls += 1;
            return 'ok';
        }, fast);
        expect(result).toBe('ok');
        expect(calls).toBe(1);
    });

    it('retries a retryable failure then succeeds', async () => {
        let calls = 0;
        const result = await withRetry(
            async () => {
                calls += 1;
                if (calls < 3) {
                    throw new Error('fetch failed');
                }
                return calls;
            },
            { ...fast, maxAttempts: 3 },
        );
        expect(result).toBe(3);
        expect(calls).toBe(3);
    });

    it('gives up after maxAttempts and rethrows the last error', async () => {
        let calls = 0;
        await expect(
            withRetry(
                async () => {
                    calls += 1;
                    throw new Error('fetch failed');
                },
                { ...fast, maxAttempts: 2 },
            ),
        ).rejects.toThrow(/fetch failed/);
        expect(calls).toBe(2);
    });

    it('does not retry when the error is not retryable', async () => {
        let calls = 0;
        await expect(
            withRetry(
                async () => {
                    calls += 1;
                    throw new Error('nope');
                },
                { ...fast, maxAttempts: 5, isRetryable: () => false },
            ),
        ).rejects.toThrow(/nope/);
        expect(calls).toBe(1);
    });
});

describe('isRetryableRpcError', () => {
    it('treats transient message patterns as retryable', () => {
        expect(isRetryableRpcError(new Error('fetch failed'))).toBe(true);
        expect(isRetryableRpcError(new Error('read ETIMEDOUT'))).toBe(true);
    });

    it('treats an unknown error as non-retryable', () => {
        expect(isRetryableRpcError(new Error('bad input'))).toBe(false);
    });

    it('retries a TimeoutError and a 5xx/429 HttpRequestError', () => {
        expect(isRetryableRpcError(new TimeoutError({ body: {}, url: 'http://rpc' }))).toBe(true);
        expect(isRetryableRpcError(new HttpRequestError({ url: 'http://rpc', status: 503 }))).toBe(true);
        expect(isRetryableRpcError(new HttpRequestError({ url: 'http://rpc', status: 429 }))).toBe(true);
    });

    it('does not retry a 4xx HttpRequestError', () => {
        expect(isRetryableRpcError(new HttpRequestError({ url: 'http://rpc', status: 400 }))).toBe(false);
    });

    it('never retries a deterministic revert', () => {
        const revert = new BaseError('execution reverted');
        revert.name = 'ContractFunctionRevertedError';
        expect(isRetryableRpcError(revert)).toBe(false);
    });
});
