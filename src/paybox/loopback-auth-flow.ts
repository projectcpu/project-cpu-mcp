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
} from './auth-flow.constants.js';
import { isPbxk1, oauthError, pkceChallenge, randomUrlPart } from './auth-flow.utils.js';
import type { LoopbackAuthFlowOptions, PayboxAuthFlow, PayboxAuthMaterial, PayboxAuthStart } from './types.js';

interface OAuthMetadata {
    authorizationEndpoint: string;
    registrationEndpoint: string;
    tokenEndpoint: string;
}

interface OAuthTokenResponse {
    accessToken: string;
    refreshToken: string | null;
    expiresAt: number | null;
    resource: string | null;
}

export class LoopbackAuthFlow implements PayboxAuthFlow {
    private server: Server | null = null;
    private completion: Promise<PayboxAuthMaterial> | null = null;
    private rejectCompletion: ((error: Error) => void) | null = null;
    private timeout: NodeJS.Timeout | null = null;
    private callbackPath: string | null = null;
    private keyPath: string | null = null;
    private state: string | null = null;
    private verifier: string | null = null;
    private metadata: OAuthMetadata | null = null;
    private clientId: string | null = null;
    private code: string | null = null;
    private key: string | null = null;
    private started = false;

    public constructor(private readonly options: LoopbackAuthFlowOptions) {}

    public async start(): Promise<PayboxAuthStart> {
        if (this.started) {
            throw oauthError('flow already started');
        }
        this.started = true;
        try {
            this.metadata = await this.discover();
            this.state = randomUrlPart();
            this.verifier = randomUrlPart();
            this.callbackPath = `${LOOPBACK_CALLBACK_PREFIX}${randomUrlPart()}`;
            this.keyPath = `${LOOPBACK_KEY_PREFIX}${randomUrlPart()}`;
            await this.listen();
            const redirectUri = this.redirectUri();
            this.clientId = await this.register(redirectUri);
            this.completion = new Promise<PayboxAuthMaterial>((resolve, reject) => {
                this.rejectCompletion = reject;
                void this.waitForResult(resolve, reject);
            });
            this.armTimeout();
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
            this.close();
            throw error;
        }
    }

    public async finish(): Promise<PayboxAuthMaterial> {
        if (this.completion === null) {
            throw oauthError('flow not started');
        }
        return this.completion;
    }

    public cancel(): void {
        this.rejectCompletion?.(oauthError('cancelled'));
        this.close();
    }

    private async discover(): Promise<OAuthMetadata> {
        const issuer = new URL(this.options.issuerUrl);
        const response = await this.options.httpClient.fetch(new URL(OAUTH_DISCOVERY_PATH, issuer).toString(), {
            method: 'GET',
        });
        if (!response.ok) throw oauthError(`discovery returned ${response.status}`);
        const value = await response.json();
        if (!isObject(value)) throw oauthError('malformed discovery response');
        const authorizationEndpoint = stringField(value, 'authorization_endpoint');
        const registrationEndpoint = stringField(value, 'registration_endpoint');
        const tokenEndpoint = stringField(value, 'token_endpoint');
        return { authorizationEndpoint, registrationEndpoint, tokenEndpoint };
    }

    private async register(redirectUri: string): Promise<string> {
        const metadata = this.required(this.metadata, 'metadata');
        const response = await this.options.httpClient.fetch(metadata.registrationEndpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ redirect_uris: [redirectUri], token_endpoint_auth_method: 'none' }),
        });
        if (!response.ok) throw oauthError(`registration returned ${response.status}`);
        const value = await response.json();
        if (!isObject(value)) throw oauthError('malformed registration response');
        return nonEmptyString(value, 'client_id');
    }

    private async listen(): Promise<void> {
        this.server = createServer((request, response) => this.handle(request, response));
        await new Promise<void>((resolve, reject) => {
            const server = this.required(this.server, 'server');
            server.once('error', reject);
            server.listen(0, LOOPBACK_HOST, () => {
                server.off('error', reject);
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
        if (!String(request.headers['content-type'] ?? '').startsWith('application/json')) {
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
                const value: unknown = JSON.parse(body);
                const key = isObject(value) ? value.key : null;
                if (typeof key !== 'string' || !isPbxk1(key)) {
                    return this.respond(response, 400, 'Invalid signing key');
                }
                this.key = key;
                this.respond(response, 200, 'Authentication complete');
            } catch {
                this.respond(response, 400, 'Invalid request');
            }
        });
    }

    private async waitForResult(
        resolve: (material: PayboxAuthMaterial) => void,
        reject: (error: Error) => void,
    ): Promise<void> {
        try {
            const code = await this.waitFor(() => this.code);
            const token = await this.exchange(code);
            const signingKey = await this.waitFor(() => this.key);
            this.close();
            resolve({
                tokens: {
                    clientId: this.required(this.clientId, 'client id'),
                    baseUrl: this.options.issuerUrl,
                    ...token,
                },
                signingKey,
            });
        } catch (error) {
            this.close();
            reject(error instanceof Error ? error : oauthError('authentication failed'));
        }
    }

    private async waitFor<T>(read: () => T | null): Promise<T> {
        while (true) {
            const value = read();
            if (value !== null) return value;
            await new Promise((resolve) => setTimeout(resolve, 10));
        }
    }

    private async exchange(code: string): Promise<OAuthTokenResponse> {
        const response = await this.options.httpClient.fetch(this.required(this.metadata, 'metadata').tokenEndpoint, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code,
                redirect_uri: this.redirectUri(),
                client_id: this.required(this.clientId, 'client id'),
                code_verifier: this.required(this.verifier, 'verifier'),
            }).toString(),
        });
        if (!response.ok) throw oauthError(`token exchange returned ${response.status}`);
        return tokenResponse(await response.json());
    }

    private armTimeout(): void {
        const delay = this.options.timeoutMs ?? DEFAULT_LOOPBACK_TIMEOUT_MS;
        this.timeout = this.options.clock.setTimeout(() => this.cancel(), delay);
    }

    private close(): void {
        if (this.timeout !== null) this.options.clock.clearTimeout(this.timeout);
        this.timeout = null;
        this.server?.close();
        this.server = null;
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

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: Record<string, unknown>, name: string): string {
    const field = nonEmptyString(value, name);
    try {
        new URL(field);
    } catch {
        throw oauthError(`invalid ${name}`);
    }
    return field;
}

function nonEmptyString(value: Record<string, unknown>, name: string): string {
    const field = value[name];
    if (typeof field !== 'string' || field.length === 0) throw oauthError(`discovery missing ${name}`);
    return field;
}

function tokenResponse(value: unknown): OAuthTokenResponse {
    if (!isObject(value) || typeof value.access_token !== 'string' || value.access_token.length === 0) {
        throw oauthError('malformed token response');
    }
    const refreshToken = typeof value.refresh_token === 'string' ? value.refresh_token : null;
    const resource = typeof value.resource === 'string' ? value.resource : null;
    const expiresIn =
        typeof value.expires_in === 'number' && Number.isFinite(value.expires_in) ? value.expires_in : null;
    return {
        accessToken: value.access_token,
        refreshToken,
        resource,
        expiresAt: expiresIn === null ? null : Date.now() + expiresIn * 1000,
    };
}
