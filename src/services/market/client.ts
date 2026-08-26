import type { z } from 'zod';

import { HTTP_INTERNAL_SERVER_ERROR, MARKET_RETRY_BUDGET_MS } from './constants.js';
import { MarketError } from './error.js';
import {
    isMarketSuccessStatus,
    isRetryableMarketCode,
    marketBackoffDelayMs,
    rateLimitDelayMs,
    retryAfterSecondsFrom,
    toMarketErrorCode,
} from './error.utils.js';
import {
    MarketErrorCode,
    marketErrorBodySchema,
    type IMarketApiClient,
    type IMarketTransport,
    type MarketApiClientOptions,
    type MarketAttempt,
    type MarketRequestInput,
} from './types.js';
import { HttpStatus, type ApiResponse } from '../../api/types.js';
import type { ILogger } from '../../logger/types.js';
import { sleep } from '../../utils/async.utils.js';
import { errorMessage } from '../../utils/error.utils.js';

export class MarketApiClient implements IMarketApiClient {
    private readonly api: IMarketTransport;
    private readonly logger: ILogger;

    constructor(options: MarketApiClientOptions) {
        this.api = options.api;
        this.logger = options.logger;
    }

    async send<TSchema extends z.ZodTypeAny>(input: MarketRequestInput<TSchema>): Promise<z.infer<TSchema>> {
        const startedAt = Date.now();

        for (let index = 1; ; index += 1) {
            const attempt: MarketAttempt = { startedAt, index };
            let response: ApiResponse<unknown>;

            try {
                response = await this.api.authenticatedRequest<unknown>(input.path, {
                    method: input.method,
                    body: input.body,
                });
            } catch (error) {
                await this.waitOrGiveUp(input, attempt, MarketErrorCode.NetworkFailure, errorMessage(error));
                continue;
            }

            if (response.status === HttpStatus.TooManyRequests) {
                await this.waitOutRateLimit(input, attempt, response);
                continue;
            }

            if (response.status >= HTTP_INTERNAL_SERVER_ERROR) {
                await this.waitOrGiveUp(
                    input,
                    attempt,
                    MarketErrorCode.ServiceUnavailable,
                    `${input.label} answered HTTP ${response.status}`,
                );
                continue;
            }

            if (response.status === HttpStatus.Unauthorized) {
                throw new MarketError({
                    code: MarketErrorCode.Unauthorized,
                    message: `${input.label} was refused after re-authentication. The wallet session is not valid.`,
                    retryable: false,
                    retryAfterSeconds: null,
                    stage: input.stage,
                    txHash: null,
                });
            }

            if (!isMarketSuccessStatus(response.status)) {
                throw this.terminalFailure(input, response);
            }

            return this.validate(input, response.data);
        }
    }

    private validate<TSchema extends z.ZodTypeAny>(
        input: MarketRequestInput<TSchema>,
        data: unknown,
    ): z.infer<TSchema> {
        const parsed = input.schema.safeParse(data);
        if (parsed.success) {
            return parsed.data as z.infer<TSchema>;
        }

        this.logger.error('market response failed validation', { path: input.path, issues: parsed.error.issues });
        throw new MarketError({
            code: MarketErrorCode.InvalidMarketResponse,
            message: `${input.label} returned data the client cannot trust: ${parsed.error.issues
                .map((issue) => `${issue.path.join('.') || '<root>'} ${issue.message}`)
                .join('; ')}`,
            retryable: false,
            retryAfterSeconds: null,
            stage: input.stage,
            txHash: null,
        });
    }

    private terminalFailure<TSchema extends z.ZodTypeAny>(
        input: MarketRequestInput<TSchema>,
        response: ApiResponse<unknown>,
    ): MarketError {
        const body = marketErrorBodySchema.safeParse(response.data);
        const code = (body.success ? toMarketErrorCode(body.data.code) : null) ?? MarketErrorCode.MarketRequestFailed;
        const message = body.success ? body.data.message : `${input.label} failed with HTTP ${response.status}.`;

        return new MarketError({
            code,
            message,
            retryable: isRetryableMarketCode(code),
            retryAfterSeconds: retryAfterSecondsFrom(response.headers),
            stage: input.stage,
            txHash: null,
        });
    }

    private async waitOutRateLimit<TSchema extends z.ZodTypeAny>(
        input: MarketRequestInput<TSchema>,
        attempt: MarketAttempt,
        response: ApiResponse<unknown>,
    ): Promise<void> {
        const body = marketErrorBodySchema.safeParse(response.data);
        const code = (body.success ? toMarketErrorCode(body.data.code) : null) ?? MarketErrorCode.UpstreamRateLimited;
        const message = body.success ? body.data.message : `${input.label} is rate limited upstream.`;
        const retryAfterSeconds = retryAfterSecondsFrom(response.headers);
        const retryable = isRetryableMarketCode(code);
        const delayMs = rateLimitDelayMs(retryAfterSeconds, attempt.index);

        if (!retryable || delayMs > this.remainingBudgetMs(attempt)) {
            throw new MarketError({
                code,
                message,
                retryable,
                retryAfterSeconds,
                stage: input.stage,
                txHash: null,
            });
        }

        this.logger.warn('market call rate limited — waiting inside the current call', {
            path: input.path,
            attempt: attempt.index,
            delayMs,
        });
        await sleep(delayMs);
    }

    private async waitOrGiveUp<TSchema extends z.ZodTypeAny>(
        input: MarketRequestInput<TSchema>,
        attempt: MarketAttempt,
        code: MarketErrorCode,
        reason: string,
    ): Promise<void> {
        const delayMs = marketBackoffDelayMs(attempt.index);

        if (delayMs > this.remainingBudgetMs(attempt)) {
            throw new MarketError({
                code,
                message: `${reason}. The automatic wait budget is spent — invoke the same tool again later.`,
                retryable: true,
                retryAfterSeconds: null,
                stage: input.stage,
                txHash: null,
            });
        }

        this.logger.warn('market call failed transiently — retrying inside the current call', {
            path: input.path,
            attempt: attempt.index,
            delayMs,
            reason,
        });
        await sleep(delayMs);
    }

    private remainingBudgetMs(attempt: MarketAttempt): number {
        return MARKET_RETRY_BUDGET_MS - (Date.now() - attempt.startedAt);
    }
}
