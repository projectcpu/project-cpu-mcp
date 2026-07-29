import { BaseError, HttpRequestError, TimeoutError } from 'viem';

import { sleep } from './async.utils.js';
import { errorMessage } from './error.utils.js';
import {
    DEFAULT_RETRY_OPTIONS,
    RETRYABLE_ERROR_PATTERNS,
    RETRYABLE_HTTP_STATUSES,
    REVERT_ERROR_NAMES,
} from './retry.constants.js';
import type { ILogger } from '../logger/types.js';

export interface RetryOptions {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    factor: number;
    isRetryable: (error: unknown) => boolean;
    logger: ILogger | null;
    label: string;
}

export function isRetryableRpcError(error: unknown): boolean {
    if (error instanceof BaseError) {
        const revert = error.walk((e) => (REVERT_ERROR_NAMES as ReadonlyArray<string>).includes((e as Error).name));
        if (revert !== null) {
            return false;
        }
        const transport = error.walk((e) => e instanceof HttpRequestError || e instanceof TimeoutError);
        if (transport instanceof TimeoutError) {
            return true;
        }
        if (transport instanceof HttpRequestError) {
            return transport.status === undefined || RETRYABLE_HTTP_STATUSES.has(transport.status);
        }
    }
    return messageLooksTransient(error);
}

function messageLooksTransient(error: unknown): boolean {
    const message = errorMessage(error).toLowerCase();
    return RETRYABLE_ERROR_PATTERNS.some((pattern) => message.includes(pattern));
}

export async function withRetry<T>(fn: () => Promise<T>, options: Partial<RetryOptions> = {}): Promise<T> {
    const opts: RetryOptions = {
        ...DEFAULT_RETRY_OPTIONS,
        isRetryable: isRetryableRpcError,
        logger: null,
        label: 'rpc call',
        ...options,
    };

    let lastError: unknown;
    for (let attempt = 1; attempt <= opts.maxAttempts; attempt += 1) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt >= opts.maxAttempts || !opts.isRetryable(error)) {
                break;
            }
            const delay = Math.min(opts.maxDelayMs, opts.baseDelayMs * opts.factor ** (attempt - 1));
            opts.logger?.warn('transient error — retrying', {
                label: opts.label,
                attempt,
                nextDelayMs: delay,
                error: errorMessage(error),
            });
            await sleep(delay);
        }
    }
    throw lastError;
}
