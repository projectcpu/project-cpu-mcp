import { AuthenticationRequiredError } from './authentication-required.error.js';
import { parseJsonBody } from './response.utils.js';
import {
    type ApiClientOptions,
    type ApiResponse,
    HttpStatus,
    type IAuthenticator,
    type ServerHealthView,
} from './types.js';
import type { ILogger } from '../logger/types.js';
import type { IJwtSession } from '../session/types.js';
import { errorMessage } from '../utils/error.utils.js';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface RequestOptions {
    method: HttpMethod;
    body: unknown | null;
}

export class ApiClient {
    private readonly baseUrl: string;
    private readonly session: IJwtSession;
    private readonly logger: ILogger;
    private authenticator: IAuthenticator | null = null;
    private serverReachable = true;
    private serverDownReason: string | null = null;

    constructor(options: ApiClientOptions) {
        this.baseUrl = options.baseUrl;
        this.session = options.session;
        this.logger = options.logger;
    }

    setAuthenticator(authenticator: IAuthenticator): void {
        this.authenticator = authenticator;
    }

    /**
     * Low-level request without auth. Use for public endpoints (SIWE nonce/verify, device flow).
     */
    async request<T>(
        path: string,
        options: RequestOptions | null = null,
        signal: AbortSignal | null = null,
    ): Promise<ApiResponse<T>> {
        return this.send<T>(path, options?.method ?? 'GET', options?.body ?? null, null, null, true, signal);
    }

    /**
     * The outcome is kept out of the reachability signal: this may target an endpoint an older server
     * does not serve at all, which says nothing about the API being up.
     */
    async requestWithTimeout<T>(path: string, timeoutMs: number): Promise<ApiResponse<T>> {
        return this.send<T>(path, 'GET', null, null, timeoutMs, false);
    }

    /**
     * Request with a `Authorization: Bearer <jwt>` header. The token is obtained from the
     * authenticator (which logs in when missing/expired). A 401 clears the game JWT and asks the
     * caller to authenticate explicitly before choosing whether to retry the operation.
     */
    async authenticatedRequest<T>(path: string, options: RequestOptions | null = null): Promise<ApiResponse<T>> {
        if (!this.authenticator) {
            throw new Error('ApiClient: no authenticator configured for authenticated requests');
        }

        const method = options?.method ?? 'GET';
        const body = options?.body ?? null;

        const token = await this.authenticator.getAccessToken();
        const response = await this.fetchResponse(path, method, body, { Authorization: `Bearer ${token}` });

        if (response.status === HttpStatus.Unauthorized) {
            this.setReachable(true, null);
            this.logger.debug('api response', { method, path, status: response.status });
            this.session.clearJwt();
            this.logger.warn('authenticated request got 401 — game JWT cleared', { path });
            throw new AuthenticationRequiredError();
        }

        return this.parseResponse<T>(response, method, path);
    }

    private async send<T>(
        path: string,
        method: HttpMethod,
        body: unknown | null,
        extraHeaders: Record<string, string> | null,
        timeoutMs: number | null = null,
        trackHealth = true,
        signal: AbortSignal | null = null,
    ): Promise<ApiResponse<T>> {
        const response = await this.fetchResponse(path, method, body, extraHeaders, timeoutMs, trackHealth, signal);

        return this.parseResponse<T>(response, method, path, trackHealth);
    }

    private async fetchResponse(
        path: string,
        method: HttpMethod,
        body: unknown | null,
        extraHeaders: Record<string, string> | null,
        timeoutMs: number | null = null,
        trackHealth = true,
        signal: AbortSignal | null = null,
    ): Promise<Response> {
        const url = `${this.baseUrl}${path}`;
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...(extraHeaders ?? {}),
        };

        const init: RequestInit = { method, headers };

        const timeoutSignal = timeoutMs === null ? null : AbortSignal.timeout(timeoutMs);
        const requestSignal =
            signal !== null && timeoutSignal !== null
                ? AbortSignal.any([signal, timeoutSignal])
                : (signal ?? timeoutSignal);
        if (requestSignal !== null) init.signal = requestSignal;

        if (body !== undefined && body !== null) {
            init.body = JSON.stringify(body);
        }

        this.logger.debug('api request', { method, path });

        let response: Response;
        try {
            response = await fetch(url, init);
        } catch (error) {
            if (signal?.aborted === true) signal.throwIfAborted();
            if (trackHealth) {
                this.setReachable(false, errorMessage(error));
            }
            throw new Error(
                `Cannot reach the game API at ${this.baseUrl} — the server is likely down or unreachable. ` +
                    `Retry shortly. (${errorMessage(error)})`,
            );
        }

        return response;
    }

    private async parseResponse<T>(
        response: Response,
        method: HttpMethod,
        path: string,
        trackHealth = true,
    ): Promise<ApiResponse<T>> {
        let data: T;
        try {
            data = await parseJsonBody<T>(response);
        } catch (error) {
            if (trackHealth) {
                this.setReachable(false, errorMessage(error));
            }
            throw error;
        }

        if (trackHealth) {
            this.setReachable(true, null);
        }
        this.logger.debug('api response', { method, path, status: response.status });

        return { status: response.status, data };
    }

    private setReachable(reachable: boolean, reason: string | null): void {
        const changed = this.serverReachable !== reachable;
        this.serverReachable = reachable;
        this.serverDownReason = reachable ? null : reason;
        if (changed) {
            if (reachable) {
                this.logger.info('game API reachable again');
            } else {
                this.logger.warn('game API unreachable', { reason });
            }
        }
    }

    getServerHealth(): ServerHealthView {
        return { reachable: this.serverReachable, reason: this.serverDownReason };
    }

    getBaseUrl(): string {
        return this.baseUrl;
    }

    getSession(): IJwtSession {
        return this.session;
    }
}
