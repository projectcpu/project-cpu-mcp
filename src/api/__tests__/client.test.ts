import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NoopLogger } from '../../logger/noop.logger.js';
import type { SessionManager } from '../../session/manager.js';
import { ApiClient } from '../client.js';

const logger = new NoopLogger();

const mockSession = {} as SessionManager;

function createClient(): ApiClient {
    return new ApiClient({ baseUrl: 'https://api.test.com', session: mockSession, logger });
}

describe('ApiClient', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('request', () => {
        it('should build URL from baseUrl + path', async () => {
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

            const client = createClient();
            await client.request('/api/v1/test');

            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.test.com/api/v1/test',
                expect.objectContaining({ method: 'GET' }),
            );
        });

        it('should set Content-Type to application/json', async () => {
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

            const client = createClient();
            await client.request('/test');

            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
                }),
            );
        });

        it('should JSON.stringify body when provided', async () => {
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

            const client = createClient();
            await client.request('/test', { method: 'POST', body: { signerAddress: '0xABC' } });

            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    method: 'POST',
                    body: '{"signerAddress":"0xABC"}',
                }),
            );
        });

        it('should return status and parsed data', async () => {
            const payload = { deviceCode: 'abc', userCode: 'XXXX-YYYY' };
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));

            const client = createClient();
            const result = await client.request<typeof payload>('/test');

            expect(result).toEqual({ status: 200, data: payload });
        });

        it('should return non-200 status without throwing', async () => {
            const payload = { error: 'authorizationPending' };
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 202 }));

            const client = createClient();
            const result = await client.request<typeof payload>('/test');

            expect(result.status).toBe(202);
            expect(result.data).toEqual(payload);
        });

        it('should default to GET when options is null', async () => {
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));

            const client = createClient();
            await client.request('/test', null);

            expect(mockFetch).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ method: 'GET' }));
        });

        it('throws a clear error on a non-JSON (HTML) response instead of a bare JSON parse error', async () => {
            mockFetch.mockResolvedValueOnce(
                new Response('<html>err</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
            );

            const client = createClient();
            await expect(client.request('/test')).rejects.toThrow(/502|non-JSON/i);
        });

        it('throws a clear error when fetch itself fails (server unreachable)', async () => {
            mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

            const client = createClient();
            await expect(client.request('/test')).rejects.toThrow(/down or unreachable/i);
        });
    });

    describe('requestWithTimeout', () => {
        it('aborts a request that never answers instead of holding the caller', async () => {
            mockFetch.mockImplementationOnce(
                async (_url: string, init: RequestInit) =>
                    new Promise<Response>((_resolve, reject) => {
                        init.signal?.addEventListener('abort', () => reject(new Error('This operation was aborted')));
                    }),
            );

            const client = createClient();

            await expect(client.requestWithTimeout('/api/version', 10)).rejects.toThrow(/down or unreachable/i);
        });

        it('keeps its own failure out of the reachability signal', async () => {
            mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

            const client = createClient();
            await expect(client.requestWithTimeout('/api/version', 10)).rejects.toThrow();

            expect(client.getServerHealth().reachable).toBe(true);
        });
    });

    describe('server health', () => {
        it('starts reachable, flips to unreachable on a non-JSON response, and recovers on the next ok response', async () => {
            const client = createClient();
            expect(client.getServerHealth().reachable).toBe(true);

            mockFetch.mockResolvedValueOnce(new Response('<html>down</html>', { status: 503 }));
            await expect(client.request('/test')).rejects.toThrow();
            expect(client.getServerHealth().reachable).toBe(false);
            expect(client.getServerHealth().reason).not.toBeNull();

            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
            await client.request('/test');
            expect(client.getServerHealth().reachable).toBe(true);
            expect(client.getServerHealth().reason).toBeNull();
        });
    });

    describe('authenticatedRequest', () => {
        const fakeAuthenticator = (token: string, fresh: string) => ({
            getAccessToken: vi.fn(async () => token),
            reauthenticate: vi.fn(async () => fresh),
        });

        it('throws when no authenticator is configured', async () => {
            const client = createClient();
            await expect(client.authenticatedRequest('/protected')).rejects.toThrow(/no authenticator/i);
        });

        it('attaches a Bearer token from the authenticator', async () => {
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

            const client = createClient();
            const authenticator = fakeAuthenticator('tok-1', 'unused');
            client.setAuthenticator(authenticator);

            await client.authenticatedRequest('/protected');

            expect(authenticator.getAccessToken).toHaveBeenCalledOnce();
            expect(authenticator.reauthenticate).not.toHaveBeenCalled();
            expect(mockFetch).toHaveBeenCalledWith(
                'https://api.test.com/protected',
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: 'Bearer tok-1' }),
                }),
            );
        });

        it('re-authenticates and retries once with the fresh token on 401', async () => {
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

            const client = createClient();
            const authenticator = fakeAuthenticator('stale', 'fresh');
            client.setAuthenticator(authenticator);

            const result = await client.authenticatedRequest('/protected');

            expect(result.status).toBe(200);
            expect(authenticator.reauthenticate).toHaveBeenCalledOnce();
            expect(mockFetch).toHaveBeenCalledTimes(2);
            expect(mockFetch).toHaveBeenLastCalledWith(
                expect.any(String),
                expect.objectContaining({
                    headers: expect.objectContaining({ Authorization: 'Bearer fresh' }),
                }),
            );
        });

        it('retries at most once — returns the second response even if it is also 401', async () => {
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 401 }));
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 401 }));

            const client = createClient();
            const authenticator = fakeAuthenticator('stale', 'fresh');
            client.setAuthenticator(authenticator);

            const result = await client.authenticatedRequest('/protected');

            expect(result.status).toBe(401);
            expect(mockFetch).toHaveBeenCalledTimes(2);
        });
    });
});
