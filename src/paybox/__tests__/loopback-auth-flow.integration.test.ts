import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LoopbackAuthFlow } from '../auth/loopback-flow.js';
import { PayboxAuthFlowError } from '../errors.js';
import type { PayboxHttpClient } from '../types.js';

vi.mock('../auth/browser-opener.js', () => ({
    SystemBrowserOpener: class {
        public readonly open = vi.fn();
    },
}));

const VALID_SIGNING_KEY =
    'pbxk1.eyJwIjoiMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMSIsInMiOiIy' +
    'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyIn0';

const controllers = new Map<LoopbackAuthFlow, AbortController>();

afterEach(() => {
    for (const controller of controllers.values()) controller.abort();
    controllers.clear();
});

function begin(flow: LoopbackAuthFlow) {
    const controller = new AbortController();
    controllers.set(flow, controller);
    return flow.start(controller.signal);
}

function finish(flow: LoopbackAuthFlow) {
    return flow.finish();
}

function abort(flow: LoopbackAuthFlow): void {
    controllers.get(flow)?.abort();
}

describe('LoopbackAuthFlow', () => {
    it.each([
        ['discovery', 401, 1],
        ['discovery', 403, 1],
        ['discovery', 422, 1],
        ['registration', 401, 2],
        ['registration', 403, 2],
        ['registration', 422, 2],
    ])('classifies %s HTTP %i as a safe auth-flow failure after %i request(s)', async (stage, status, count) => {
        const fetchRequest = vi.fn(async (url: string) => {
            if (stage === 'discovery' || url.includes('/register')) {
                return { ...response({ raw_body: 'secret' }), ok: false, status };
            }
            return response({
                authorization_endpoint: 'https://issuer.example/authorize',
                registration_endpoint: 'https://issuer.example/register?private_stage=registration',
                token_endpoint: 'https://issuer.example/token',
            });
        });
        const flow = new LoopbackAuthFlow({
            issuerUrl: 'https://issuer.example',
            httpClient: { fetch: fetchRequest },
            timeoutMs: 1000,
        });

        const failure = begin(flow);

        await expect(failure).rejects.toBeInstanceOf(PayboxAuthFlowError);
        await expect(failure).rejects.toMatchObject({
            data: {
                code: 'PAYBOX_AUTHORIZATION_FAILED',
                stateCleared: false,
                retryable: false,
                nextTool: 'cpu_authenticate',
            },
            diagnostic: {
                failureClass: 'authentication_flow',
                resetCause: null,
                resetDepth: 'none',
            },
        });
        await expect(failure).rejects.not.toThrow(/secret|registration|private_stage/u);
        expect(fetchRequest).toHaveBeenCalledTimes(count);
    });

    it.each([
        ['discovery', {}, 1],
        [
            'registration',
            {
                authorization_endpoint: 'https://issuer.example/authorize',
                registration_endpoint: 'https://issuer.example/register',
                token_endpoint: 'https://issuer.example/token',
            },
            2,
        ],
    ])('classifies a malformed %s response without exposing its internal stage', async (stage, discovery, count) => {
        const fetchRequest = vi.fn(async (url: string) => {
            if (stage === 'registration' && url.endsWith('/register')) return response({ client_id: '' });
            return response(discovery);
        });
        const flow = new LoopbackAuthFlow({
            issuerUrl: 'https://issuer.example',
            httpClient: { fetch: fetchRequest },
            timeoutMs: 1000,
        });

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
        await expect(failure).rejects.not.toThrow(/discovery|registration|response|client_id/u);
        expect(fetchRequest).toHaveBeenCalledTimes(count);
    });

    it('classifies rejected discovery JSON without exposing parser details', async () => {
        const fetchRequest = vi.fn(async () => ({
            ok: true,
            status: 200,
            async json(): Promise<unknown> {
                throw new SyntaxError('raw discovery body secret?private_stage=discovery');
            },
        }));
        const flow = new LoopbackAuthFlow({
            issuerUrl: 'https://issuer.example',
            httpClient: { fetch: fetchRequest },
            timeoutMs: 1000,
        });

        const failure = begin(flow);

        await expectParserFailure(failure, /raw|secret|private_stage|discovery|parser|SyntaxError/u);
        expect(fetchRequest).toHaveBeenCalledOnce();
    });

    it('classifies rejected registration JSON without exposing parser details', async () => {
        const fetchRequest = vi.fn(async (url: string) => {
            if (url.endsWith('/register')) {
                return {
                    ok: true,
                    status: 200,
                    async json(): Promise<unknown> {
                        throw new SyntaxError('raw registration body secret?private_stage=registration');
                    },
                };
            }
            return response({
                authorization_endpoint: 'https://issuer.example/authorize',
                registration_endpoint: 'https://issuer.example/register',
                token_endpoint: 'https://issuer.example/token',
            });
        });
        const flow = new LoopbackAuthFlow({
            issuerUrl: 'https://issuer.example',
            httpClient: { fetch: fetchRequest },
            timeoutMs: 1000,
        });

        const failure = begin(flow);

        await expectParserFailure(failure, /raw|secret|private_stage|registration|parser|SyntaxError/u);
        expect(fetchRequest).toHaveBeenCalledTimes(2);
    });

    it.each([
        ['HTTP 429', { ...response({}), ok: false, status: 429 }],
        ['HTTP 503', { ...response({}), ok: false, status: 503 }],
        ['network failure', new TypeError('fetch failed with access_token=secret')],
        ['timeout', new DOMException('timed out with refresh_token=secret', 'TimeoutError')],
    ])('classifies discovery %s as temporary before opening a browser listener', async (_case, outcome) => {
        const fetchRequest = vi.fn(async () => {
            if (outcome instanceof Error) throw outcome;
            return outcome;
        });
        const flow = new LoopbackAuthFlow({
            issuerUrl: 'https://issuer.example',
            httpClient: { fetch: fetchRequest },
            timeoutMs: 1000,
        });

        const failure = begin(flow);

        await expect(failure).rejects.toMatchObject({
            data: { code: 'PAYBOX_TEMPORARILY_UNAVAILABLE', stateCleared: false, retryable: true },
        });
        await expect(failure).rejects.not.toThrow('secret');
        expect(fetchRequest).toHaveBeenCalledOnce();
    });

    it('opens the authorization URL once after discovery, listening, and registration succeed', async () => {
        const stages = new Array<string>();
        const openBrowser = vi.fn(async () => {
            stages.push('browser');
        });
        const client: PayboxHttpClient = {
            async fetch(url) {
                if (url.endsWith('/.well-known/oauth-authorization-server')) {
                    stages.push('discovery');
                    return response({
                        authorization_endpoint: 'https://issuer.example/authorize',
                        registration_endpoint: 'https://issuer.example/register',
                        token_endpoint: 'https://issuer.example/token',
                    });
                }
                stages.push('registration');
                return response({ client_id: 'client' });
            },
        };
        const options = {
            issuerUrl: 'https://issuer.example',
            httpClient: client,
            timeoutMs: 1000,
        };
        const flow = new LoopbackAuthFlow(options, { open: openBrowser });

        const start = await begin(flow);

        expect(stages).toEqual(['discovery', 'registration', 'browser']);
        expect(openBrowser).toHaveBeenCalledOnce();
        expect(openBrowser).toHaveBeenCalledWith(start.authorizationUrl);
        await expect(flow.start(new AbortController().signal)).rejects.toBeInstanceOf(PayboxAuthFlowError);
        expect(openBrowser).toHaveBeenCalledOnce();
    });

    it('returns the authorization URL when the injected browser opener throws', async () => {
        const openBrowser = vi.fn(() => {
            throw new Error('headless');
        });
        const flow = new LoopbackAuthFlow(
            {
                issuerUrl: 'https://issuer.example',
                httpClient: fakeClient(),
                timeoutMs: 1000,
            },
            { open: openBrowser },
        );

        const start = await begin(flow);

        expect(start.authorizationUrl).toMatch(/^https:\/\/issuer\.example\/authorize\?/u);
        expect(openBrowser).toHaveBeenCalledOnce();
    });

    it('performs discovery, registration, PKCE exchange and one-shot key capture', async () => {
        const requests: Array<{ url: string; init: RequestInit }> = [];
        const client: PayboxHttpClient = {
            async fetch(url, init) {
                requests.push({ url, init });
                if (url.endsWith('/.well-known/oauth-authorization-server')) {
                    return response({
                        authorization_endpoint: 'https://issuer.example/authorize',
                        registration_endpoint: 'https://issuer.example/register',
                        token_endpoint: 'https://issuer.example/token',
                    });
                }
                if (url === 'https://issuer.example/register') return response({ client_id: 'client-1' });
                return response({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 60 });
            },
        };
        const flow = new LoopbackAuthFlow({
            issuerUrl: 'https://issuer.example',
            httpClient: client,
            timeoutMs: 1000,
        });

        const pending = await begin(flow);
        const authorization = new URL(pending.authorizationUrl);
        const redirect = new URL(authorization.searchParams.get('redirect_uri') ?? '');
        expect(redirect.hostname).toBe('127.0.0.1');
        expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
        expect(authorization.searchParams.get('state')).toHaveLength(43);

        const callback = new URL(redirect);
        callback.searchParams.set('code', 'code-1');
        callback.searchParams.set('state', authorization.searchParams.get('state') ?? '');
        const callbackResponse = await fetch(callback);
        expect(callbackResponse.status).toBe(200);
        expect(callbackResponse.headers.get('cache-control')).toBe('no-store');
        expect(callbackResponse.headers.get('content-security-policy')).toContain("default-src 'none'");
        const keyPath = /action="([^"]+)"/.exec(await callbackResponse.text())?.[1] ?? '';
        const keyResponse = await fetch(new URL(keyPath, redirect), {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ key: VALID_SIGNING_KEY }).toString(),
        });
        expect(keyResponse.status).toBe(200);

        await expect(finish(flow)).resolves.toMatchObject({ signingKey: VALID_SIGNING_KEY });
        const registration = JSON.parse(String(requests[1]?.init.body));
        expect(registration.redirect_uris).toEqual([redirect.toString()]);
        const exchanged = new URLSearchParams(String(requests[2]?.init.body));
        expect(exchanged.get('code')).toBe('code-1');
        expect(exchanged.get('code_verifier')).toHaveLength(43);
        expect(exchanged.get('code_challenge')).toBeNull();
        expect(authorization.searchParams.get('code_challenge')).toBe(
            createHash('sha256')
                .update(exchanged.get('code_verifier') ?? '')
                .digest('base64url'),
        );
    });

    it('rejects wrong paths and state without exchanging a code', async () => {
        const client = fakeClient();
        const flow = new LoopbackAuthFlow({
            issuerUrl: 'https://issuer.example',
            httpClient: client,
            timeoutMs: 1000,
        });
        const start = await begin(flow);
        const authorization = new URL(start.authorizationUrl);
        const redirect = new URL(authorization.searchParams.get('redirect_uri') ?? '');
        const wrong = new URL(redirect);
        wrong.pathname = '/wrong';
        expect((await fetch(wrong)).status).toBe(404);
        redirect.searchParams.set('code', 'code');
        redirect.searchParams.set('state', 'wrong');
        expect((await fetch(redirect)).status).toBe(400);
        abort(flow);
        await expect(finish(flow)).rejects.toBeInstanceOf(PayboxAuthFlowError);
    });

    it('rejects invalid, oversized, and duplicate key submissions without reflecting secrets', async () => {
        const flow = new LoopbackAuthFlow({
            issuerUrl: 'https://issuer.example',
            httpClient: fakeClient(),
            timeoutMs: 1000,
        });
        const start = await begin(flow);
        const authorization = new URL(start.authorizationUrl);
        const redirect = new URL(authorization.searchParams.get('redirect_uri') ?? '');
        redirect.searchParams.set('code', 'code');
        redirect.searchParams.set('state', authorization.searchParams.get('state') ?? '');
        const page = await fetch(redirect);
        const keyUrl = new URL(/action="([^"]+)"/.exec(await page.text())?.[1] ?? '', redirect);
        expect((await fetch(keyUrl)).status).toBe(405);
        const bad = await fetch(keyUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'key=secret',
        });
        expect(bad.status).toBe(400);
        expect(await bad.text()).not.toContain('secret');
        for (const key of ['pbxk1.abcdefghijklmnop', 'pbxk1.eyJwIjoiYWEifQ', 'pbxk1.eyJwIjoiemoiLCJzIjoiMTEifQ']) {
            expect(
                (
                    await fetch(keyUrl, {
                        method: 'POST',
                        headers: { 'content-type': 'application/x-www-form-urlencoded' },
                        body: new URLSearchParams({ key }).toString(),
                    })
                ).status,
            ).toBe(400);
        }
        const huge = await fetch(keyUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/x-www-form-urlencoded' },
            body: 'x'.repeat(5000),
        });
        expect(huge.status).toBe(413);
        expect(
            (
                await fetch(keyUrl, {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ key: VALID_SIGNING_KEY }).toString(),
                })
            ).status,
        ).toBe(200);
        expect(
            (
                await fetch(keyUrl, {
                    method: 'POST',
                    headers: { 'content-type': 'application/x-www-form-urlencoded' },
                    body: 'key=pbxk1.qrstuvwxyzabcdef',
                })
            ).status,
        ).toBe(409);
        await expect(finish(flow)).resolves.toMatchObject({ signingKey: VALID_SIGNING_KEY });
    });

    it('observes an unpolled timeout while preserving finish rejection and retry', async () => {
        const flow = new LoopbackAuthFlow({
            issuerUrl: 'https://issuer.example',
            httpClient: fakeClient(),
            timeoutMs: 10,
        });
        const unhandled: Array<unknown> = [];
        const observe = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', observe);
        try {
            await begin(flow);
            await new Promise<void>((resolve) => setTimeout(resolve, 20));
            expect(unhandled).toEqual([]);
            await expect(finish(flow)).rejects.toBeInstanceOf(PayboxAuthFlowError);
            await expect(begin(flow)).resolves.toEqual(
                expect.objectContaining({ authorizationUrl: expect.any(String) }),
            );
        } finally {
            process.off('unhandledRejection', observe);
        }
    });

    it('observes an unpolled exchange failure, cleans up, and permits retry', async () => {
        let failExchange = true;
        const client: PayboxHttpClient = {
            async fetch(url) {
                if (url.endsWith('/.well-known/oauth-authorization-server')) {
                    return response({
                        authorization_endpoint: 'https://issuer.example/authorize',
                        registration_endpoint: 'https://issuer.example/register',
                        token_endpoint: 'https://issuer.example/token',
                    });
                }
                if (url.endsWith('/register')) return response({ client_id: 'client' });
                if (failExchange) {
                    failExchange = false;
                    return { ...response({}), ok: false, status: 503 };
                }
                return response({ access_token: 'access' });
            },
        };
        const flow = new LoopbackAuthFlow({
            issuerUrl: 'https://issuer.example',
            httpClient: client,
            timeoutMs: 1000,
        });
        const unhandled: Array<unknown> = [];
        const observe = (reason: unknown): void => {
            unhandled.push(reason);
        };
        process.on('unhandledRejection', observe);
        try {
            const start = await begin(flow);
            const authorization = new URL(start.authorizationUrl);
            const callback = new URL(authorization.searchParams.get('redirect_uri') ?? '');
            callback.searchParams.set('code', 'code');
            callback.searchParams.set('state', authorization.searchParams.get('state') ?? '');
            expect((await fetch(callback)).status).toBe(200);
            await new Promise<void>((resolve) => setImmediate(resolve));
            expect(unhandled).toEqual([]);
            await expect(finish(flow)).rejects.toMatchObject({
                data: { code: 'PAYBOX_TEMPORARILY_UNAVAILABLE', stateCleared: false, retryable: true },
            });
            await expect(begin(flow)).resolves.toEqual(
                expect.objectContaining({ authorizationUrl: expect.any(String) }),
            );
        } finally {
            process.off('unhandledRejection', observe);
        }
    });

    it.each([
        ['HTTP 429', { ...response({ raw_body: 'secret' }), ok: false, status: 429 }],
        ['network failure', new TypeError('fetch failed with authorization_code=secret')],
        ['timeout', new DOMException('token request timed out with code=secret', 'TimeoutError')],
    ])('classifies OAuth exchange %s after exactly one token request', async (_case, outcome) => {
        const fetchRequest = vi.fn(async (url: string) => {
            if (url.endsWith('/.well-known/oauth-authorization-server')) {
                return response({
                    authorization_endpoint: 'https://issuer.example/authorize',
                    registration_endpoint: 'https://issuer.example/register',
                    token_endpoint: 'https://issuer.example/token',
                });
            }
            if (url.endsWith('/register')) return response({ client_id: 'client' });
            if (outcome instanceof Error) throw outcome;
            return outcome;
        });
        const flow = new LoopbackAuthFlow({
            issuerUrl: 'https://issuer.example',
            httpClient: { fetch: fetchRequest },
            timeoutMs: 1000,
        });
        const start = await begin(flow);
        const authorization = new URL(start.authorizationUrl);
        const callback = new URL(authorization.searchParams.get('redirect_uri') ?? '');
        callback.searchParams.set('code', 'secret-code');
        callback.searchParams.set('state', authorization.searchParams.get('state') ?? '');

        expect((await fetch(callback)).status).toBe(200);
        await new Promise<void>((resolve) => setImmediate(resolve));

        const failure = finish(flow);
        await expect(failure).rejects.toMatchObject({
            data: { code: 'PAYBOX_TEMPORARILY_UNAVAILABLE', stateCleared: false, retryable: true },
        });
        await expect(failure).rejects.not.toThrow(/secret-code|authorization_code|token request|exchange/u);
        expect(fetchRequest).toHaveBeenCalledTimes(3);
    });

    it('classifies rejected token JSON after exactly one exchange without exposing callback or parser details', async () => {
        const fetchRequest = vi.fn(async (url: string) => {
            if (url.endsWith('/.well-known/oauth-authorization-server')) {
                return response({
                    authorization_endpoint: 'https://issuer.example/authorize',
                    registration_endpoint: 'https://issuer.example/register',
                    token_endpoint: 'https://issuer.example/token?private_stage=exchange',
                });
            }
            if (url.endsWith('/register')) return response({ client_id: 'client' });
            return {
                ok: true,
                status: 200,
                async json(): Promise<unknown> {
                    throw new SyntaxError('raw token body secret-code from parser');
                },
            };
        });
        const flow = new LoopbackAuthFlow({
            issuerUrl: 'https://issuer.example',
            httpClient: { fetch: fetchRequest },
            timeoutMs: 1000,
        });
        const start = await begin(flow);
        const authorization = new URL(start.authorizationUrl);
        const callback = new URL(authorization.searchParams.get('redirect_uri') ?? '');
        callback.searchParams.set('code', 'secret-code');
        callback.searchParams.set('state', authorization.searchParams.get('state') ?? '');

        expect((await fetch(callback)).status).toBe(200);
        await new Promise<void>((resolve) => setImmediate(resolve));

        const failure = finish(flow);
        await expectParserFailure(failure, /raw|secret-code|private_stage|exchange|parser|SyntaxError/u);
        expect(fetchRequest).toHaveBeenCalledTimes(3);
        expect(fetchRequest.mock.calls.filter(([url]) => String(url).includes('/token')).length).toBe(1);
    });

    it('cancels pending work and permits a clean replacement start', async () => {
        const flow = new LoopbackAuthFlow({
            issuerUrl: 'https://issuer.example',
            httpClient: fakeClient(),
            timeoutMs: 1000,
        });
        await begin(flow);
        abort(flow);
        await expect(finish(flow)).rejects.toBeInstanceOf(PayboxAuthFlowError);
        await expect(begin(flow)).resolves.toEqual(expect.objectContaining({ authorizationUrl: expect.any(String) }));
    });

    it('invalidates a start cancelled while discovery is unresolved', async () => {
        const discovery = controlledPromise<ReturnType<typeof response>>();
        const discoverySignals = new Array<AbortSignal>();
        let discoveryPending = true;
        let registrationCalls = 0;
        const client: PayboxHttpClient = {
            async fetch(url, init) {
                if (url.endsWith('/.well-known/oauth-authorization-server') && discoveryPending) {
                    discoveryPending = false;
                    discoverySignals.push(init.signal as AbortSignal);
                    return discovery.promise;
                }
                if (url.endsWith('/.well-known/oauth-authorization-server')) {
                    return response({
                        authorization_endpoint: 'https://issuer.example/authorize',
                        registration_endpoint: 'https://issuer.example/register',
                        token_endpoint: 'https://issuer.example/token',
                    });
                }
                if (url.endsWith('/register')) {
                    registrationCalls += 1;
                    return response({ client_id: 'client' });
                }
                return response({ access_token: 'access' });
            },
        };
        const flow = new LoopbackAuthFlow({
            issuerUrl: 'https://issuer.example',
            httpClient: client,
            timeoutMs: 1000,
        });

        const cancelledStart = begin(flow);
        await new Promise<void>((resolve) => setImmediate(resolve));
        abort(flow);
        expect(discoverySignals[0]?.aborted).toBe(true);
        discovery.resolve(
            response({
                authorization_endpoint: 'https://issuer.example/authorize',
                registration_endpoint: 'https://issuer.example/register',
                token_endpoint: 'https://issuer.example/token',
            }),
        );

        await expect(cancelledStart).rejects.toBeInstanceOf(PayboxAuthFlowError);
        expect(registrationCalls).toBe(0);
        await expect(begin(flow)).resolves.toEqual(expect.objectContaining({ authorizationUrl: expect.any(String) }));
        expect(registrationCalls).toBe(1);
    });
});

function response(value: unknown) {
    return {
        ok: true,
        status: 200,
        async json() {
            return value;
        },
    };
}

function fakeClient(): PayboxHttpClient {
    return {
        async fetch(url) {
            if (url.endsWith('/.well-known/oauth-authorization-server'))
                return response({
                    authorization_endpoint: 'https://issuer.example/authorize',
                    registration_endpoint: 'https://issuer.example/register',
                    token_endpoint: 'https://issuer.example/token',
                });
            if (url.endsWith('/register')) return response({ client_id: 'client' });
            return response({ access_token: 'access' });
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

async function expectParserFailure(failure: Promise<unknown>, forbidden: RegExp): Promise<void> {
    const error: unknown = await failure.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(PayboxAuthFlowError);
    expect(error).toHaveProperty('data', {
        code: 'PAYBOX_AUTHORIZATION_FAILED',
        stateCleared: false,
        retryable: false,
        nextTool: 'cpu_authenticate',
    });
    expect(error).toHaveProperty('diagnostic', {
        failureClass: 'authentication_flow',
        resetCause: null,
        resetDepth: 'none',
    });
    expect(error).not.toHaveProperty('cause');
    expect(String(error)).not.toMatch(forbidden);
}
