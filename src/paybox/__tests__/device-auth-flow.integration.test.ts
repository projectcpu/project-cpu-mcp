import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeviceAuthFlow } from '../auth/device-flow.js';
import { PayboxAuthFlowError, PayboxAuthInvalidError, PayboxTemporarilyUnavailableError } from '../errors.js';
import type { PayboxHttpClient, PayboxHttpResponse } from '../types.js';

vi.mock('../auth/browser-opener.js', () => ({
    SystemBrowserOpener: class {
        public readonly open = vi.fn();
    },
}));

const VALID_SIGNING_KEY =
    'pbxk1.eyJwIjoiMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMSIsInMiOiIy' +
    'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyIn0';
const PAYBOX_AGENT_CLIENT_ID = 'agent-client';
const ACCESS_TOKEN = `header.${Buffer.from(JSON.stringify({ cid: PAYBOX_AGENT_CLIENT_ID })).toString('base64url')}.signature`;
const DEVICE_AUTHORIZATION_URL = 'https://accounts.paybox.test/device?user_code=ABCD-EFGH';

const controllers = new Map<DeviceAuthFlow, AbortController>();

afterEach(() => {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
    vi.useRealTimers();
});

function begin(flow: DeviceAuthFlow) {
    const controller = new AbortController();
    controllers.set(flow, controller);
    return flow.start(controller.signal);
}

function finish(flow: DeviceAuthFlow) {
    return flow.finish();
}

function abort(flow: DeviceAuthFlow): void {
    controllers.get(flow)?.abort();
}

describe('DeviceAuthFlow', () => {
    it('starts the Paybox device-code grant advertised by OAuth discovery', async () => {
        const requests = new Array<{ url: string; init: RequestInit }>();
        const openBrowser = vi.fn();
        const flow = new DeviceAuthFlow(
            {
                issuerUrl: 'https://issuer.example',
                httpClient: {
                    async fetch(url, init) {
                        requests.push({ url, init });
                        if (url.endsWith('/.well-known/oauth-authorization-server')) {
                            return response(discovery());
                        }
                        if (url.endsWith('/register')) return response({ client_id: 'oauth-client' });
                        return response(deviceAuthorization());
                    },
                },
                timeoutMs: 1000,
            },
            { open: openBrowser },
        );

        const start = await begin(flow);

        expect(start).toEqual({ authorizationUrl: DEVICE_AUTHORIZATION_URL });
        expect(openBrowser).toHaveBeenCalledWith(start.authorizationUrl);
        expect(requests.map(({ url }) => url)).toEqual([
            'https://issuer.example/.well-known/oauth-authorization-server',
            'https://issuer.example/register',
            'https://issuer.example/device',
        ]);
        expect(JSON.parse(String(requests[1]?.init.body))).toEqual({
            client_name: 'Project CPU MCP',
            redirect_uris: ['http://127.0.0.1/device'],
            token_endpoint_auth_method: 'none',
            grant_types: ['urn:ietf:params:oauth:grant-type:device_code', 'refresh_token'],
            response_types: ['code'],
            scope: 'mcp offline_access',
        });
        expect(new URLSearchParams(String(requests[2]?.init.body))).toEqual(
            new URLSearchParams({
                client_id: 'oauth-client',
                scope: 'mcp offline_access',
                resource: 'https://issuer.example/mcp',
            }),
        );
    });

    it.each([
        ['discovery', 401, 1],
        ['discovery', 403, 1],
        ['discovery', 422, 1],
        ['registration', 401, 2],
        ['registration', 403, 2],
        ['registration', 422, 2],
        ['device authorization', 401, 3],
        ['device authorization', 403, 3],
        ['device authorization', 422, 3],
    ])('classifies %s HTTP %i as a safe auth-flow failure after %i request(s)', async (stage, status, count) => {
        const fetchRequest = vi.fn(async (url: string) => {
            if (stage === 'discovery') return failedResponse(status);
            if (url.endsWith('/.well-known/oauth-authorization-server')) return response(discovery());
            if (stage === 'registration' || url.endsWith('/device')) return failedResponse(status);
            return response({ client_id: 'oauth-client' });
        });
        const flow = flowWith({ fetch: fetchRequest });

        const failure = begin(flow);

        await expect(failure).rejects.toBeInstanceOf(PayboxAuthFlowError);
        await expect(failure).rejects.toMatchObject({
            data: {
                code: 'PAYBOX_AUTHORIZATION_FAILED',
                stateCleared: false,
                retryable: false,
                nextTool: 'cpu_authenticate',
            },
        });
        await expect(failure).rejects.not.toThrow(/secret|registration|device authorization/u);
        expect(fetchRequest).toHaveBeenCalledTimes(count);
    });

    it.each([
        ['discovery', 1],
        ['registration', 2],
        ['device authorization', 3],
    ])('classifies a malformed %s response without exposing its internal stage', async (stage, count) => {
        const fetchRequest = vi.fn(async (url: string) => {
            if (stage === 'discovery') return response({});
            if (url.endsWith('/.well-known/oauth-authorization-server')) return response(discovery());
            if (url.endsWith('/register')) {
                return response({ client_id: stage === 'registration' ? '' : 'oauth-client' });
            }
            return response(stage === 'device authorization' ? {} : deviceAuthorization());
        });
        const flow = flowWith({ fetch: fetchRequest });

        const failure = begin(flow);

        await expect(failure).rejects.toBeInstanceOf(PayboxAuthFlowError);
        await expect(failure).rejects.not.toThrow(/discovery|registration|device|response|client_id/u);
        expect(fetchRequest).toHaveBeenCalledTimes(count);
    });

    it.each([
        ['discovery', 1],
        ['registration', 2],
        ['device authorization', 3],
    ])('classifies rejected %s JSON without exposing parser details', async (stage, count) => {
        const fetchRequest = vi.fn(async (url: string) => {
            if (stage === 'discovery') return rejectedJsonResponse('raw discovery secret');
            if (url.endsWith('/.well-known/oauth-authorization-server')) return response(discovery());
            if (url.endsWith('/register')) {
                return stage === 'registration'
                    ? rejectedJsonResponse('raw registration secret')
                    : response({ client_id: 'oauth-client' });
            }
            return stage === 'device authorization'
                ? rejectedJsonResponse('raw device secret')
                : response(deviceAuthorization());
        });
        const flow = flowWith({ fetch: fetchRequest });

        const failure = begin(flow);

        await expectParserFailure(failure, /raw|secret|discovery|registration|device|parser|SyntaxError/u);
        expect(fetchRequest).toHaveBeenCalledTimes(count);
    });

    it.each([
        ['HTTP 429', failedResponse(429)],
        ['HTTP 503', failedResponse(503)],
        ['network failure', new TypeError('fetch failed with access_token=secret')],
        ['timeout', new DOMException('timed out with refresh_token=secret', 'TimeoutError')],
    ])('classifies discovery %s as temporary before opening a browser listener', async (_case, outcome) => {
        const fetchRequest = vi.fn(async () => {
            if (outcome instanceof Error) throw outcome;
            return outcome;
        });
        const flow = flowWith({ fetch: fetchRequest });

        const failure = begin(flow);

        await expect(failure).rejects.toBeInstanceOf(PayboxTemporarilyUnavailableError);
        await expect(failure).rejects.not.toThrow('secret');
        expect(fetchRequest).toHaveBeenCalledOnce();
    });

    it('opens the complete device verification URL once after startup succeeds', async () => {
        const stages = new Array<string>();
        const openBrowser = vi.fn(() => stages.push('browser'));
        const client: PayboxHttpClient = {
            async fetch(url) {
                if (url.endsWith('/.well-known/oauth-authorization-server')) {
                    stages.push('discovery');
                    return response(discovery());
                }
                if (url.endsWith('/register')) {
                    stages.push('registration');
                    return response({ client_id: 'oauth-client' });
                }
                stages.push('device authorization');
                return response(deviceAuthorization());
            },
        };
        const flow = flowWith(client, openBrowser);

        const start = await begin(flow);

        expect(stages).toEqual(['discovery', 'registration', 'device authorization', 'browser']);
        expect(openBrowser).toHaveBeenCalledOnce();
        expect(openBrowser).toHaveBeenCalledWith(start.authorizationUrl);
        await expect(flow.start(new AbortController().signal)).rejects.toBeInstanceOf(PayboxAuthFlowError);
        expect(openBrowser).toHaveBeenCalledOnce();
    });

    it('returns the device verification URL when the injected browser opener throws', async () => {
        const openBrowser = vi.fn(() => {
            throw new Error('headless');
        });
        const flow = flowWith(fakeClient(), openBrowser);

        const start = await begin(flow);

        expect(start).toEqual({ authorizationUrl: DEVICE_AUTHORIZATION_URL });
        expect(openBrowser).toHaveBeenCalledOnce();
    });

    it('polls device authorization and captures a one-shot signing key locally', async () => {
        const requests = new Array<{ url: string; init: RequestInit }>();
        const openBrowser = vi.fn();
        let tokenRequests = 0;
        const client: PayboxHttpClient = {
            async fetch(url, init) {
                requests.push({ url, init });
                if (url.endsWith('/.well-known/oauth-authorization-server')) return response(discovery());
                if (url.endsWith('/register')) return response({ client_id: 'oauth-client' });
                if (url.endsWith('/device')) return response(deviceAuthorization({ interval: 0.001 }));
                tokenRequests += 1;
                if (tokenRequests === 1) return response({ error: 'authorization_pending' }, 400);
                return response({ access_token: ACCESS_TOKEN, refresh_token: 'refresh-token', expires_in: 60 });
            },
        };
        const flow = flowWith(client, openBrowser);

        const pending = await begin(flow);
        expect(pending.authorizationUrl).toBe(DEVICE_AUTHORIZATION_URL);
        await waitForBrowserCalls(openBrowser, 2);

        expect(openBrowser).not.toHaveBeenCalledWith(
            `https://app.paybox.test/agent-key?client_id=${PAYBOX_AGENT_CLIENT_ID}`,
        );
        const captureUrl = String(openBrowser.mock.calls[1]?.[0]);
        expect(captureUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/key\//u);
        const captureResponse = await fetch(captureUrl);
        expect(captureResponse.status).toBe(200);
        expect(captureResponse.headers.get('cache-control')).toBe('no-store');
        expect(captureResponse.headers.get('content-security-policy')).toContain("default-src 'none'");
        const captureHtml = await captureResponse.text();
        expect(captureHtml).toContain('name="key"');
        expect(captureHtml).toContain('type="password"');
        expect(captureHtml).toContain(`https://app.paybox.test/agent-key?client_id=${PAYBOX_AGENT_CLIENT_ID}`);

        const keyResponse = await fetch(captureUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ key: VALID_SIGNING_KEY }).toString(),
        });
        expect(keyResponse.status).toBe(200);
        expect(await keyResponse.text()).toContain('You can close this tab and return to Project CPU.');
        await expect(finish(flow)).resolves.toMatchObject({
            tokens: {
                clientId: 'oauth-client',
                accessToken: ACCESS_TOKEN,
                refreshToken: 'refresh-token',
                resource: 'https://api.paybox.test/mcp',
                baseUrl: 'https://api.paybox.test',
            },
            signingKey: VALID_SIGNING_KEY,
        });

        const tokenBodies = requests
            .filter(({ url }) => url.endsWith('/token'))
            .map(({ init }) => new URLSearchParams(String(init.body)));
        expect(tokenBodies).toHaveLength(2);
        expect(tokenBodies[0]).toEqual(
            new URLSearchParams({
                grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
                device_code: 'device-secret',
                client_id: 'oauth-client',
            }),
        );
    });

    it('honors authorization_pending and the five-second slow_down backoff', async () => {
        vi.useFakeTimers();
        let tokenRequests = 0;
        const client: PayboxHttpClient = {
            async fetch(url) {
                if (url.endsWith('/.well-known/oauth-authorization-server')) return response(discovery());
                if (url.endsWith('/register')) return response({ client_id: 'oauth-client' });
                if (url.endsWith('/device')) return response(deviceAuthorization({ interval: 1 }));
                tokenRequests += 1;
                return response({ error: tokenRequests === 1 ? 'slow_down' : 'authorization_pending' }, 400);
            },
        };
        const flow = flowWith(client, vi.fn(), 20_000);
        await begin(flow);

        await vi.advanceTimersByTimeAsync(999);
        expect(tokenRequests).toBe(0);
        await vi.advanceTimersByTimeAsync(1);
        expect(tokenRequests).toBe(1);
        await vi.advanceTimersByTimeAsync(5_999);
        expect(tokenRequests).toBe(1);
        await vi.advanceTimersByTimeAsync(1);
        expect(tokenRequests).toBe(2);

        abort(flow);
        await expect(finish(flow)).rejects.toBeInstanceOf(PayboxAuthFlowError);
        vi.useRealTimers();
    });

    it('rejects invalid, oversized, and duplicate key submissions without reflecting secrets', async () => {
        const openBrowser = vi.fn();
        const flow = flowWith(successfulClient(), openBrowser);
        await begin(flow);
        await waitForBrowserCalls(openBrowser, 2);
        const captureUrl = new URL(String(openBrowser.mock.calls[1]?.[0]));

        const wrong = new URL(captureUrl);
        wrong.pathname = '/wrong';
        expect((await fetch(wrong)).status).toBe(404);
        expect((await fetch(captureUrl, { method: 'PUT' })).status).toBe(405);
        expect((await fetch(captureUrl, { method: 'POST' })).status).toBe(415);
        const bad = await fetch(captureUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'key=secret',
        });
        expect(bad.status).toBe(400);
        expect(await bad.text()).not.toContain('secret');
        const huge = await fetch(captureUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'x'.repeat(5000),
        });
        expect(huge.status).toBe(413);
        expect(
            (
                await fetch(captureUrl, {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ key: VALID_SIGNING_KEY }).toString(),
                })
            ).status,
        ).toBe(200);
        expect(
            (
                await fetch(captureUrl, {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ key: VALID_SIGNING_KEY }).toString(),
                })
            ).status,
        ).toBe(409);
        await expect(finish(flow)).resolves.toMatchObject({ signingKey: VALID_SIGNING_KEY });
    });

    it.each(['/.well-known/oauth-authorization-server', '/register', '/device'])(
        'bounds a stalled %s request and allows a replacement start',
        async (stalledPath) => {
            let stalled = true;
            const client: PayboxHttpClient = {
                async fetch(url, init) {
                    if (stalled && url.endsWith(stalledPath)) {
                        return new Promise<PayboxHttpResponse>((_resolve, reject) => {
                            const signal = init.signal as AbortSignal;
                            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
                        });
                    }
                    if (url.endsWith('/.well-known/oauth-authorization-server')) return response(discovery());
                    if (url.endsWith('/register')) return response({ client_id: 'oauth-client' });
                    return response(deviceAuthorization());
                },
            };
            const openBrowser = vi.fn();
            const flow = flowWith(client, openBrowser, 20);
            await expect(begin(flow)).rejects.toBeInstanceOf(PayboxAuthFlowError);
            expect(openBrowser).not.toHaveBeenCalled();
            stalled = false;
            await expect(begin(flow)).resolves.toEqual({ authorizationUrl: DEVICE_AUTHORIZATION_URL });
        },
    );

    it('observes an unpolled timeout while preserving finish rejection and retry', async () => {
        const flow = flowWith(fakeClient({ interval: 0.001 }), vi.fn(), 10);
        const unhandled = new Array<unknown>();
        const observe = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', observe);
        try {
            await begin(flow);
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
            expect(unhandled).toEqual([]);
            await expect(finish(flow)).rejects.toBeInstanceOf(PayboxAuthFlowError);
            await expect(begin(flow)).resolves.toEqual({ authorizationUrl: DEVICE_AUTHORIZATION_URL });
        } finally {
            process.off('unhandledRejection', observe);
        }
    });

    it.each([
        ['HTTP 429', failedResponse(429)],
        ['network failure', new TypeError('fetch failed with device_code=secret')],
        ['timeout', new DOMException('token request timed out with device_code=secret', 'TimeoutError')],
    ])('classifies device token polling %s after one request', async (_case, outcome) => {
        const fetchRequest = vi.fn(async (url: string) => {
            if (url.endsWith('/.well-known/oauth-authorization-server')) return response(discovery());
            if (url.endsWith('/register')) return response({ client_id: 'oauth-client' });
            if (url.endsWith('/device')) return response(deviceAuthorization({ interval: 0.001 }));
            if (outcome instanceof Error) throw outcome;
            return outcome;
        });
        const flow = flowWith({ fetch: fetchRequest });
        await begin(flow);

        const failure = finish(flow);

        await expect(failure).rejects.toBeInstanceOf(PayboxTemporarilyUnavailableError);
        await expect(failure).rejects.not.toThrow(/secret|device_code|token request/u);
        expect(fetchRequest).toHaveBeenCalledTimes(4);
    });

    it('classifies a denied device authorization as invalid OAuth authority', async () => {
        const flow = flowWith(clientWithTokenResponse(response({ error: 'access_denied' }, 400)));
        await begin(flow);

        await expect(finish(flow)).rejects.toBeInstanceOf(PayboxAuthInvalidError);
    });

    it('classifies rejected token JSON without exposing parser details', async () => {
        const flow = flowWith(clientWithTokenResponse(rejectedJsonResponse('raw token body secret from parser')));
        await begin(flow);

        await expectParserFailure(finish(flow), /raw|secret|token|parser|SyntaxError/u);
    });

    it('cancels pending polling and permits a clean replacement start', async () => {
        const flow = flowWith(fakeClient());
        await begin(flow);
        abort(flow);
        await expect(finish(flow)).rejects.toBeInstanceOf(PayboxAuthFlowError);
        await expect(begin(flow)).resolves.toEqual({ authorizationUrl: DEVICE_AUTHORIZATION_URL });
    });

    it('invalidates a start cancelled while discovery is unresolved', async () => {
        const pendingDiscovery = controlledPromise<PayboxHttpResponse>();
        const discoverySignals = new Array<AbortSignal>();
        let firstDiscovery = true;
        let registrationCalls = 0;
        const client: PayboxHttpClient = {
            async fetch(url, init) {
                if (url.endsWith('/.well-known/oauth-authorization-server') && firstDiscovery) {
                    firstDiscovery = false;
                    discoverySignals.push(init.signal as AbortSignal);
                    return pendingDiscovery.promise;
                }
                if (url.endsWith('/.well-known/oauth-authorization-server')) return response(discovery());
                if (url.endsWith('/register')) {
                    registrationCalls += 1;
                    return response({ client_id: 'oauth-client' });
                }
                return response(deviceAuthorization());
            },
        };
        const flow = flowWith(client);

        const cancelledStart = begin(flow);
        await new Promise<void>((resolve) => setImmediate(resolve));
        abort(flow);
        expect(discoverySignals[0]?.aborted).toBe(true);
        await expect(begin(flow)).resolves.toEqual({ authorizationUrl: DEVICE_AUTHORIZATION_URL });
        pendingDiscovery.resolve(response(discovery()));

        await expect(cancelledStart).rejects.toBeInstanceOf(PayboxAuthFlowError);
        expect(registrationCalls).toBe(1);
        await expect(flow.start(new AbortController().signal)).rejects.toBeInstanceOf(PayboxAuthFlowError);
    });

    it('does not let a cancelled finish dispose its replacement flow', async () => {
        const pendingToken = controlledPromise<PayboxHttpResponse>();
        let firstToken = true;
        const tokenRequested = controlledPromise<void>();
        const client: PayboxHttpClient = {
            async fetch(url) {
                if (url.endsWith('/.well-known/oauth-authorization-server')) return response(discovery());
                if (url.endsWith('/register')) return response({ client_id: 'oauth-client' });
                if (url.endsWith('/device')) return response(deviceAuthorization({ interval: 0.001 }));
                if (firstToken) {
                    firstToken = false;
                    tokenRequested.resolve();
                    return pendingToken.promise;
                }
                return response({ access_token: ACCESS_TOKEN });
            },
        };
        const openBrowser = vi.fn();
        const flow = flowWith(client, openBrowser);
        await begin(flow);
        const cancelledFinish = finish(flow);
        const rejection = expect(cancelledFinish).rejects.toBeInstanceOf(PayboxAuthFlowError);
        await tokenRequested.promise;
        abort(flow);
        await begin(flow);
        pendingToken.resolve(response({ access_token: ACCESS_TOKEN }));
        await rejection;
        await waitForBrowserCalls(openBrowser, 3);
        const captureUrl = openBrowser.mock.calls[2]?.[0] as string;
        const submitted = await fetch(captureUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ key: VALID_SIGNING_KEY }).toString(),
        });
        expect(submitted.status).toBe(200);
        await expect(finish(flow)).resolves.toMatchObject({ signingKey: VALID_SIGNING_KEY });
        await expect(fetch(captureUrl)).rejects.toThrow();
    });
});

function flowWith(client: PayboxHttpClient, open = vi.fn(), timeoutMs = 1000): DeviceAuthFlow {
    return new DeviceAuthFlow(
        {
            issuerUrl: 'https://api.paybox.test',
            httpClient: client,
            timeoutMs,
        },
        { open },
    );
}

function fakeClient(deviceOverrides: Record<string, unknown> = {}): PayboxHttpClient {
    return {
        async fetch(url) {
            if (url.endsWith('/.well-known/oauth-authorization-server')) return response(discovery());
            if (url.endsWith('/register')) return response({ client_id: 'oauth-client' });
            if (url.endsWith('/device')) return response(deviceAuthorization(deviceOverrides));
            return response({ error: 'authorization_pending' }, 400);
        },
    };
}

function successfulClient(): PayboxHttpClient {
    return clientWithTokenResponse(response({ access_token: ACCESS_TOKEN, refresh_token: 'refresh-token' }));
}

function clientWithTokenResponse(tokenResult: PayboxHttpResponse): PayboxHttpClient {
    return {
        async fetch(url) {
            if (url.endsWith('/.well-known/oauth-authorization-server')) return response(discovery());
            if (url.endsWith('/register')) return response({ client_id: 'oauth-client' });
            if (url.endsWith('/device')) return response(deviceAuthorization({ interval: 0.001 }));
            return tokenResult;
        },
    };
}

function discovery(): Record<string, unknown> {
    return {
        device_authorization_endpoint: 'https://issuer.example/device',
        registration_endpoint: 'https://issuer.example/register',
        token_endpoint: 'https://issuer.example/token',
    };
}

function deviceAuthorization(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        device_code: 'device-secret',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://accounts.paybox.test/device',
        verification_uri_complete: DEVICE_AUTHORIZATION_URL,
        expires_in: 600,
        interval: 60,
        ...overrides,
    };
}

function response(value: unknown, status = 200): PayboxHttpResponse {
    return {
        ok: status >= 200 && status < 300,
        status,
        async json() {
            return value;
        },
    };
}

function failedResponse(status: number): PayboxHttpResponse {
    return response({ raw_body: 'secret' }, status);
}

function rejectedJsonResponse(message: string): PayboxHttpResponse {
    return {
        ok: true,
        status: 200,
        async json(): Promise<unknown> {
            throw new SyntaxError(message);
        },
    };
}

function controlledPromise<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolvePromise = (_value: T): void => undefined;
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: resolvePromise };
}

async function waitForBrowserCalls(openBrowser: ReturnType<typeof vi.fn>, count: number): Promise<void> {
    await vi.waitFor(() => expect(openBrowser).toHaveBeenCalledTimes(count));
}

async function expectParserFailure(failure: Promise<unknown>, forbidden: RegExp): Promise<void> {
    const error: unknown = await failure.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PayboxAuthFlowError);
    expect(error).toHaveProperty('data', {
        code: 'PAYBOX_AUTHORIZATION_FAILED',
        stateCleared: false,
        retryable: false,
        nextTool: 'cpu_authenticate',
    });
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toMatch(forbidden);
}
