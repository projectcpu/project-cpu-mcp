import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import {
    DEFAULT_LOOPBACK_TIMEOUT_MS,
    HTML_HEADERS,
    KEY_BODY_LIMIT_BYTES,
    LOOPBACK_CALLBACK_PREFIX,
    LOOPBACK_HOST,
    LOOPBACK_KEY_PREFIX,
    OAUTH_DISCOVERY_PATH,
    OAUTH_SCOPE,
} from './constants.js';
import { oauthError, oauthTokenError, pkceChallenge, randomUrlPart } from './utils.js';
import {
    PayboxAuthFlowError,
    PayboxAuthInvalidError,
    PayboxLoopbackUnavailableError,
    PayboxTemporarilyUnavailableError,
} from '../errors.js';
import { formKey, isObject, nonEmptyString, tokenResponse, urlField } from './loopback-flow.utils.js';
import { isPbxk1 } from './signing-key.utils.js';
import { classifiedPayboxError, classifiedPayboxHttpStatus } from '../sdk/utils.js';
import {
    type LoopbackAuthFlowOptions,
    type OAuthMetadata,
    type OAuthTokenResponse,
    type PayboxAuthFlow,
    type PayboxAuthMaterial,
    type PayboxAuthStart,
    type PayboxHttpResponse,
    PayboxRequestContext,
} from '../types.js';

export class LoopbackAuthFlow implements PayboxAuthFlow {
    private server: Server | null = null;
    private completion: Promise<PayboxAuthMaterial> | null = null;
    private rejectCompletion: ((error: Error) => void) | null = null;
    private callbackPath: string | null = null;
    private keyPath: string | null = null;
    private state: string | null = null;
    private verifier: string | null = null;
    private metadata: OAuthMetadata | null = null;
    private clientId: string | null = null;
    private code: string | null = null;
    private key: string | null = null;
    private started = false;
    private operation: AbortController | null = null;
    private signal: AbortSignal | null = null;
    private abortListener: (() => void) | null = null;
    private readonly waiters = new Set<() => void>();
    private readonly waiterRejectors = new Set<(error: Error) => void>();

    public constructor(private readonly options: LoopbackAuthFlowOptions) {}

    public async start(parentSignal: AbortSignal): Promise<PayboxAuthStart> {
        if (this.started) {
            throw oauthError('flow already started');
        }
        this.started = true;
        const operation = new AbortController();
        const timeout = AbortSignal.timeout(this.options.timeoutMs ?? DEFAULT_LOOPBACK_TIMEOUT_MS);
        const signal = AbortSignal.any([parentSignal, operation.signal, timeout]);
        this.operation = operation;
        this.signal = signal;
        this.abortListener = () => this.abort(signal.reason);
        signal.addEventListener('abort', this.abortListener, { once: true });
        try {
            signal.throwIfAborted();
            const metadata = await this.discover(signal);
            signal.throwIfAborted();
            this.metadata = metadata;
            this.state = randomUrlPart();
            this.verifier = randomUrlPart();
            this.callbackPath = `${LOOPBACK_CALLBACK_PREFIX}${randomUrlPart()}`;
            this.keyPath = `${LOOPBACK_KEY_PREFIX}${randomUrlPart()}`;
            await this.listen(signal);
            signal.throwIfAborted();
            const redirectUri = this.redirectUri();
            const clientId = await this.register(redirectUri, signal);
            signal.throwIfAborted();
            this.clientId = clientId;
            const completion = new Promise<PayboxAuthMaterial>((resolve, reject) => {
                this.rejectCompletion = reject;
                void this.waitForResult(resolve);
            });
            void completion.catch(() => undefined);
            this.completion = completion;
            const authorizationUrl = new URL(this.metadata.authorizationEndpoint);
            authorizationUrl.searchParams.set('response_type', 'code');
            authorizationUrl.searchParams.set('client_id', this.clientId);
            authorizationUrl.searchParams.set('redirect_uri', redirectUri);
            authorizationUrl.searchParams.set('scope', OAUTH_SCOPE);
            authorizationUrl.searchParams.set('state', this.state);
            authorizationUrl.searchParams.set('code_challenge', pkceChallenge(this.verifier));
            authorizationUrl.searchParams.set('code_challenge_method', 'S256');
            return { authorizationUrl: authorizationUrl.toString() };
        } catch (error) {
            if (signal.aborted) throw this.abortError(signal.reason);
            if (this.signal === signal) this.reset();
            throw error;
        }
    }

    public async finish(): Promise<PayboxAuthMaterial> {
        if (this.completion === null) {
            throw oauthError('flow not started');
        }
        return this.completion.finally(() => this.close());
    }

    private async discover(signal: AbortSignal): Promise<OAuthMetadata> {
        const issuer = new URL(this.options.issuerUrl);
        const response = await this.payboxRequest(
            new URL(OAUTH_DISCOVERY_PATH, issuer).toString(),
            { method: 'GET' },
            signal,
        );
        if (!response.ok) {
            throw classifiedPayboxHttpStatus(response.status, PayboxRequestContext.Unauthenticated);
        }
        const value = await this.responseJson(response);
        if (!isObject(value)) throw oauthError('malformed discovery response');
        const authorizationEndpoint = urlField(value, 'authorization_endpoint');
        const registrationEndpoint = urlField(value, 'registration_endpoint');
        const tokenEndpoint = urlField(value, 'token_endpoint');
        return { authorizationEndpoint, registrationEndpoint, tokenEndpoint };
    }

    private async register(redirectUri: string, signal: AbortSignal): Promise<string> {
        const metadata = this.required(this.metadata, 'metadata');
        const response = await this.payboxRequest(
            metadata.registrationEndpoint,
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }),
            },
            signal,
        );
        if (!response.ok) {
            throw classifiedPayboxHttpStatus(response.status, PayboxRequestContext.Unauthenticated);
        }
        const value = await this.responseJson(response);
        if (!isObject(value)) throw oauthError('malformed registration response');
        return nonEmptyString(value, 'client_id');
    }

    private async listen(signal: AbortSignal): Promise<void> {
        this.server = createServer((request, response) => this.handle(request, response));
        await new Promise<void>((resolve, reject) => {
            const server = this.required(this.server, 'server');
            const onAbort = () => {
                cleanup();
                reject(this.abortError(signal.reason));
            };
            const onError = (error: Error) => {
                cleanup();
                reject(new PayboxLoopbackUnavailableError('loopback unavailable', { cause: error }));
            };
            const cleanup = () => {
                signal.removeEventListener('abort', onAbort);
                server.off('error', onError);
            };
            signal.addEventListener('abort', onAbort, { once: true });
            server.once('error', onError);
            server.listen(0, LOOPBACK_HOST, () => {
                cleanup();
                resolve();
            });
        });
    }

    private redirectUri(): string {
        const address = this.required(this.server, 'server').address();
        if (address === null || typeof address === 'string') throw oauthError('loopback address unavailable');
        return `http://${LOOPBACK_HOST}:${address.port}${this.required(this.callbackPath, 'callback path')}`;
    }

    private handle(request: IncomingMessage, response: ServerResponse): void {
        const url = new URL(request.url ?? '/', `http://${LOOPBACK_HOST}`);
        if (url.pathname === this.callbackPath) {
            this.handleCallback(request, response, url);
            return;
        }
        if (url.pathname === this.keyPath) {
            this.handleKey(request, response);
            return;
        }
        this.respond(response, 404, 'Not found');
    }

    private handleCallback(request: IncomingMessage, response: ServerResponse, url: URL): void {
        if (request.method !== 'GET') return this.respond(response, 405, 'Method not allowed');
        if (url.searchParams.get('state') !== this.state || url.searchParams.get('code') === null) {
            return this.respond(response, 400, 'Invalid callback');
        }
        if (this.code !== null) return this.respond(response, 409, 'Already used');
        this.code = url.searchParams.get('code');
        this.notifyWaiters();
        this.respond(
            response,
            200,
            `<form method="post" action="${this.keyPath}"><input name="key" type="password" autocomplete="off"><button>Continue</button></form>`,
        );
    }

    private handleKey(request: IncomingMessage, response: ServerResponse): void {
        if (request.method === 'GET') {
            this.respond(response, 405, 'Method not allowed');
            return;
        }
        if (request.method !== 'POST') return this.respond(response, 405, 'Method not allowed');
        if (!String(request.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) {
            return this.respond(response, 415, 'Unsupported media type');
        }
        let body = '';
        let size = 0;
        request.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size <= KEY_BODY_LIMIT_BYTES) body += chunk.toString('utf8');
        });
        request.on('end', () => {
            if (size > KEY_BODY_LIMIT_BYTES) return this.respond(response, 413, 'Request too large');
            if (this.key !== null) return this.respond(response, 409, 'Already used');
            try {
                const key = formKey(body);
                if (typeof key !== 'string' || !isPbxk1(key)) {
                    return this.respond(response, 400, 'Invalid signing key');
                }
                this.key = key;
                this.notifyWaiters();
                this.respond(response, 200, 'Authentication complete');
            } catch {
                this.respond(response, 400, 'Invalid request');
            }
        });
    }

    private async waitForResult(resolve: (material: PayboxAuthMaterial) => void): Promise<void> {
        try {
            const code = await this.waitFor(() => this.code);
            const token = await this.exchange(code, this.required(this.signal, 'signal'));
            const signingKey = await this.waitFor(() => this.key);
            resolve({
                tokens: {
                    clientId: this.required(this.clientId, 'client id'),
                    baseUrl: this.options.issuerUrl,
                    ...token,
                },
                signingKey,
            });
        } catch (error) {
            if (this.started) {
                this.fail(error instanceof Error ? error : oauthError('authentication failed'));
            }
        }
    }

    private async waitFor<T>(read: () => T | null): Promise<T> {
        const value = read();
        if (value !== null) return value;
        return new Promise<T>((resolve, reject) => {
            const check = () => {
                const next = read();
                if (next === null) return;
                this.waiters.delete(check);
                this.waiterRejectors.delete(reject);
                resolve(next);
            };
            this.waiters.add(check);
            this.waiterRejectors.add(reject);
        });
    }

    private async exchange(code: string, signal: AbortSignal): Promise<OAuthTokenResponse> {
        const response = await this.payboxRequest(
            this.required(this.metadata, 'metadata').tokenEndpoint,
            {
                method: 'POST',
                headers: { 'content-type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({
                    grant_type: 'authorization_code',
                    code,
                    redirect_uri: this.redirectUri(),
                    client_id: this.required(this.clientId, 'client id'),
                    code_verifier: this.required(this.verifier, 'verifier'),
                }).toString(),
            },
            signal,
        );
        if (!response.ok) throw oauthTokenError(response.status);
        return tokenResponse(await this.responseJson(response));
    }

    private async payboxRequest(url: string, init: RequestInit, signal: AbortSignal): Promise<PayboxHttpResponse> {
        try {
            return await this.options.httpClient.fetch(url, { ...init, signal });
        } catch (error) {
            if (signal.aborted) throw this.abortError(signal.reason);
            throw classifiedPayboxError(error, PayboxRequestContext.Unauthenticated);
        }
    }

    private async responseJson(response: PayboxHttpResponse): Promise<unknown> {
        try {
            return await response.json();
        } catch {
            throw oauthError('malformed response');
        }
    }

    private close(): void {
        this.server?.close();
        this.server?.closeAllConnections();
        this.server = null;
    }

    private fail(error: Error): void {
        const operation = this.operation;
        this.abort(error);
        operation?.abort(error);
    }

    private abort(reason: unknown): void {
        const error = this.abortError(reason);
        void this.completion?.catch(() => undefined);
        this.rejectCompletion?.(error);
        for (const reject of this.waiterRejectors) reject(error);
        this.waiters.clear();
        this.waiterRejectors.clear();
        this.reset();
        this.rejectCompletion = null;
    }

    private abortError(reason: unknown): Error {
        if (
            reason instanceof PayboxAuthFlowError ||
            reason instanceof PayboxAuthInvalidError ||
            reason instanceof PayboxTemporarilyUnavailableError
        ) {
            return reason;
        }
        return oauthError('cancelled');
    }

    private reset(): void {
        if (this.signal !== null && this.abortListener !== null) {
            this.signal.removeEventListener('abort', this.abortListener);
        }
        this.close();
        this.started = false;
        this.operation = null;
        this.signal = null;
        this.abortListener = null;
        this.callbackPath = null;
        this.keyPath = null;
        this.state = null;
        this.verifier = null;
        this.metadata = null;
        this.clientId = null;
        this.code = null;
        this.key = null;
    }

    private notifyWaiters(): void {
        for (const waiter of this.waiters) waiter();
    }

    private respond(response: ServerResponse, status: number, body: string): void {
        response.writeHead(status, HTML_HEADERS);
        response.end(body);
    }

    private required<T>(value: T | null, name: string): T {
        if (value === null) throw oauthError(`${name} unavailable`);
        return value;
    }
}
