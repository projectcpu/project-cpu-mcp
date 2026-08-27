import { createHash } from 'node:crypto';

import { afterEach, describe, expect, it } from 'vitest';

import { LoopbackAuthFlow } from '../loopback-auth-flow.js';
import type { PayboxHttpClient } from '../types.js';

const flows: Array<LoopbackAuthFlow> = [];

afterEach(() => {
    for (const flow of flows) flow.cancel();
    flows.length = 0;
});

describe('LoopbackAuthFlow', () => {
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
            clock,
            timeoutMs: 1000,
        });
        flows.push(flow);

        const pending = await flow.start();
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
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ key: 'pbxk1.abcdefghijklmnop' }),
        });
        expect(keyResponse.status).toBe(200);

        await expect(flow.finish()).resolves.toMatchObject({ signingKey: 'pbxk1.abcdefghijklmnop' });
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
            clock,
            timeoutMs: 1000,
        });
        flows.push(flow);
        const start = await flow.start();
        const authorization = new URL(start.authorizationUrl);
        const redirect = new URL(authorization.searchParams.get('redirect_uri') ?? '');
        const wrong = new URL(redirect);
        wrong.pathname = '/wrong';
        expect((await fetch(wrong)).status).toBe(404);
        redirect.searchParams.set('code', 'code');
        redirect.searchParams.set('state', 'wrong');
        expect((await fetch(redirect)).status).toBe(400);
        flow.cancel();
        await expect(flow.finish()).rejects.toThrow('cancelled');
    });

    it('rejects invalid, oversized, and duplicate key submissions without reflecting secrets', async () => {
        const flow = new LoopbackAuthFlow({
            issuerUrl: 'https://issuer.example',
            httpClient: fakeClient(),
            clock,
            timeoutMs: 1000,
        });
        flows.push(flow);
        const start = await flow.start();
        const authorization = new URL(start.authorizationUrl);
        const redirect = new URL(authorization.searchParams.get('redirect_uri') ?? '');
        redirect.searchParams.set('code', 'code');
        redirect.searchParams.set('state', authorization.searchParams.get('state') ?? '');
        const page = await fetch(redirect);
        const keyUrl = new URL(/action="([^"]+)"/.exec(await page.text())?.[1] ?? '', redirect);
        expect((await fetch(keyUrl)).status).toBe(405);
        const bad = await fetch(keyUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{"key":"secret"}',
        });
        expect(bad.status).toBe(400);
        expect(await bad.text()).not.toContain('secret');
        const huge = await fetch(keyUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: 'x'.repeat(5000),
        });
        expect(huge.status).toBe(413);
        expect(
            (
                await fetch(keyUrl, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ key: 'pbxk1.abcdefghijklmnop' }),
                })
            ).status,
        ).toBe(200);
        expect(
            (
                await fetch(keyUrl, {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({ key: 'pbxk1.qrstuvwxyzabcdef' }),
                })
            ).status,
        ).toBe(409);
        await expect(flow.finish()).resolves.toMatchObject({ signingKey: 'pbxk1.abcdefghijklmnop' });
    });
});

const clock = { setTimeout, clearTimeout };

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
