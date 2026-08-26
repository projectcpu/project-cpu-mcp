import type { z } from 'zod';

import { MarketWaitBudget } from './budget.js';
import { currentMarketWaitBudget } from './budget.scope.js';
import type { IMarketSingleShotClient } from './client.types.js';
import { HTTP_INTERNAL_SERVER_ERROR, MARKET_RETRY_BUDGET_MS } from './constants.js';
import { MarketError } from './error.js';
import {
    isMarketSuccessStatus,
    isRetryableMarketCode,
    marketBackoffDelayMs,
    rateLimitDelayMs,
    retryAfterSecondsFrom,
    toMarketErrorCode,
    waitRefusalNote,
} from './error.utils.js';
import {
    MarketErrorCode,
    marketErrorBodySchema,
    type IMarketTransport,
    type IMarketWaitBudget,
    type MarketApiClientOptions,
    type MarketAttempt,
    type MarketBudgetedRequest,
    type MarketRequestInput,
} from './types.js';
import { HttpStatus, type ApiResponse } from '../../api/types.js';
import type { ILogger } from '../../logger/types.js';
import { errorMessage } from '../../utils/error.utils.js';

export class MarketApiClient implements IMarketSingleShotClient {
    private readonly api: IMarketTransport;
    private readonly logger: ILogger;

    constructor(options: MarketApiClientOptions) {
        this.api = options.api;
        this.logger = options.logger;
    }

    async send<TSchema extends z.ZodTypeAny>(input: MarketRequestInput<TSchema>): Promise<z.infer<TSchema>> {
        const budgeted: MarketBudgetedRequest<TSchema> = { ...input, budget: this.budgetFor() };

        for (let index = 1; ; index += 1) {
            const attempt: MarketAttempt = { index };
            let response: ApiResponse<unknown>;

            try {
                response = await this.api.authenticatedRequest<unknown>(input.path, {
                    method: input.method,
                    body: input.body,
                });
            } catch (error) {
                await this.waitOrGiveUp(budgeted, attempt, MarketErrorCode.NetworkFailure, errorMessage(error));
                continue;
            }

            if (response.status === HttpStatus.TooManyRequests) {
                await this.waitOutRateLimit(budgeted, attempt, response);
                continue;
            }

            if (response.status >= HTTP_INTERNAL_SERVER_ERROR) {
                await this.waitOrGiveUp(
                    budgeted,
                    attempt,
                    MarketErrorCode.ServiceUnavailable,
                    `${input.label} answered HTTP ${response.status}`,
                );
                continue;
            }

            if (response.status === HttpStatus.Unauthorized) {
                throw this.rejectedSession(input);
            }

            if (!isMarketSuccessStatus(response.status)) {
                throw this.terminalFailure(input, response);
            }

            return this.validate(input, response.data);
        }
    }

    async sendOnce<TSchema extends z.ZodTypeAny>(input: MarketRequestInput<TSchema>): Promise<z.infer<TSchema>> {
        let response: ApiResponse<unknown>;

        try {
            response = await this.api.authenticatedRequest<unknown>(input.path, {
                method: input.method,
                body: input.body,
            });
        } catch (error) {
            this.logger.warn('a single-shot market call failed in transport and will not be repeated here', {
                path: input.path,
                reason: errorMessage(error),
            });
            throw new MarketError({
                code: MarketErrorCode.NetworkFailure,
                message: `${input.label} failed before an answer arrived: ${errorMessage(error)}.`,
                retryable: true,
                retryAfterSeconds: null,
                stage: input.stage,
                txHash: null,
            });
        }

        if (response.status === HttpStatus.TooManyRequests || response.status >= HTTP_INTERNAL_SERVER_ERROR) {
            throw this.congestionFailure(input, response);
        }

        if (response.status === HttpStatus.Unauthorized) {
            throw this.rejectedSession(input);
        }

        if (!isMarketSuccessStatus(response.status)) {
            throw this.terminalFailure(input, response);
        }

        return this.validate(input, response.data);
    }

    private rejectedSession<TSchema extends z.ZodTypeAny>(input: MarketRequestInput<TSchema>): MarketError {
        return new MarketError({
            code: MarketErrorCode.Unauthorized,
            message: `${input.label} was refused after re-authentication. The wallet session is not valid.`,
            retryable: false,
            retryAfterSeconds: null,
            stage: input.stage,
            txHash: null,
        });
    }

    private congestionFailure<TSchema extends z.ZodTypeAny>(
        input: MarketRequestInput<TSchema>,
        response: ApiResponse<unknown>,
    ): MarketError {
        const retryAfterSeconds = retryAfterSecondsFrom(response.headers);

        if (response.status !== HttpStatus.TooManyRequests) {
            return new MarketError({
                code: MarketErrorCode.ServiceUnavailable,
                message: `${input.label} answered HTTP ${response.status}.`,
                retryable: true,
                retryAfterSeconds,
                stage: input.stage,
                txHash: null,
            });
        }

        const body = marketErrorBodySchema.safeParse(response.data);
        const code = (body.success ? toMarketErrorCode(body.data.code) : null) ?? MarketErrorCode.UpstreamRateLimited;

        return new MarketError({
            code,
            message: body.success ? body.data.message : `${input.label} is rate limited upstream.`,
            retryable: isRetryableMarketCode(code),
            retryAfterSeconds,
            stage: input.stage,
            txHash: null,
        });
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

    private budgetFor(): IMarketWaitBudget {
        return (
            currentMarketWaitBudget() ??
            new MarketWaitBudget({ totalMs: MARKET_RETRY_BUDGET_MS, deadlineAtSeconds: null })
        );
    }

    private async waitOutRateLimit<TSchema extends z.ZodTypeAny>(
        input: MarketBudgetedRequest<TSchema>,
        attempt: MarketAttempt,
        response: ApiResponse<unknown>,
    ): Promise<void> {
        const body = marketErrorBodySchema.safeParse(response.data);
        const code = (body.success ? toMarketErrorCode(body.data.code) : null) ?? MarketErrorCode.UpstreamRateLimited;
        const message = body.success ? body.data.message : `${input.label} is rate limited upstream.`;
        const retryAfterSeconds = retryAfterSecondsFrom(response.headers);
        const retryable = isRetryableMarketCode(code);
        const delayMs = rateLimitDelayMs(retryAfterSeconds, attempt.index);
        const refusal = input.budget.refuse(delayMs);

        if (!retryable || refusal !== null) {
            throw new MarketError({
                code,
                message: refusal === null ? message : `${message} ${waitRefusalNote(refusal, delayMs)}`,
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
        await input.budget.wait(delayMs);
    }

    private async waitOrGiveUp<TSchema extends z.ZodTypeAny>(
        input: MarketBudgetedRequest<TSchema>,
        attempt: MarketAttempt,
        code: MarketErrorCode,
        reason: string,
    ): Promise<void> {
        const delayMs = marketBackoffDelayMs(attempt.index);
        const refusal = input.budget.refuse(delayMs);

        if (refusal !== null) {
            throw new MarketError({
                code,
                message: `${reason}. ${waitRefusalNote(refusal, delayMs)}`,
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
        await input.budget.wait(delayMs);
    }
}
