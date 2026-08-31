import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NoopLogger } from '../../logger/noop.logger.js';
import type { ILogger } from '../../logger/types.js';
import type { IJwtSession } from '../../session/types.js';
import { AuthenticationRequiredError } from '../authentication-required.error.js';
import { ApiClient } from '../client.js';

const logger = new NoopLogger();

const mockSession: IJwtSession = { clearJwt: vi.fn() };

function createClient(overLogger: ILogger = logger): ApiClient {
    return new ApiClient({ baseUrl: 'https://api.test.com', session: mockSession, logger: overLogger });
}

describe('ApiClient', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        vi.clearAllMocks();
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
            await client.request('/test', { method: 'POST', body: { address: '0xABC' } });

            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({
                    method: 'POST',
                    body: '{"address":"0xABC"}',
                }),
            );
        });

        it('should return status and parsed data', async () => {
            const payload = { nonce: 'abc123def456', issuedAt: '2026-01-01T00:00:00.000Z' };
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(payload), { status: 200 }));

            const client = createClient();
            const result = await client.request<typeof payload>('/test');

            expect(result).toEqual({ status: 200, data: payload, headers: expect.any(Headers) });
        });

        it('debug-logs the exact action and parsed response body at the HTTP boundary', async () => {
            const requestBody = { tokenId: '1', expectedOrderHash: `0x${'e'.repeat(64)}`, maxAmount: '10000' };
            const responseBody = {
                statusCode: 400,
                error: 'Bad Request',
                message: ['maxAmount: Required'],
            };
            const debug = vi.fn();
            const observingLogger = {
                debug,
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                child: vi.fn(),
            } as unknown as ILogger;
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(responseBody), { status: 400 }));

            await createClient(observingLogger).request('/api/v1/market/purchases/prepare', {
                method: 'POST',
                body: requestBody,
            });

            expect(debug).toHaveBeenNthCalledWith(1, 'api request', {
                method: 'POST',
                path: '/api/v1/market/purchases/prepare',
                body: requestBody,
            });
            expect(debug).toHaveBeenNthCalledWith(2, 'api response', {
                method: 'POST',
                path: '/api/v1/market/purchases/prepare',
                status: 400,
                body: responseBody,
            });
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

        it('propagates caller cancellation without rewriting the abort reason', async () => {
            const controller = new AbortController();
            mockFetch.mockImplementationOnce(
                async (_url: string, init: RequestInit) =>
                    new Promise<Response>((_resolve, reject) => {
                        init.signal?.addEventListener('abort', () => reject(init.signal?.reason));
                    }),
            );
            const client = createClient();

            const request = client.request('/test', null, controller.signal);
            controller.abort(new Error('authentication invalidated'));

            await expect(request).rejects.toThrow('authentication invalidated');
            expect(mockFetch).toHaveBeenCalledWith(
                expect.any(String),
                expect.objectContaining({ signal: controller.signal }),
            );
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

    describe('response headers', () => {
        it('hands the caller the response headers alongside the status, so Retry-After can be read', async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'retry-after': '7' } }),
            );

            const client = createClient();
            const result = await client.request('/test');

            expect(result.status).toBe(200);
            expect(result.headers.get('retry-after')).toBe('7');
        });

        it('preserves the headers of an error response too', async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(JSON.stringify({ code: 'upstreamRateLimited', message: 'slow down' }), {
                    status: 429,
                    headers: { 'retry-after': '30' },
                }),
            );

            const client = createClient();
            const result = await client.request('/test');

            expect(result.status).toBe(429);
            expect(result.headers.get('retry-after')).toBe('30');
            expect(result.data).toEqual({ code: 'upstreamRateLimited', message: 'slow down' });
        });
    });

    describe('bare rate limiting', () => {
        it('returns a non-JSON 429 as a status and headers rather than failing to parse it', async () => {
            mockFetch.mockResolvedValueOnce(
                new Response('<html>Too Many Requests</html>', {
                    status: 429,
                    headers: { 'content-type': 'text/html', 'retry-after': '60' },
                }),
            );

            const client = createClient();
            const result = await client.request('/test');

            expect(result.status).toBe(429);
            expect(result.headers.get('retry-after')).toBe('60');
            expect(result.data).toBeNull();
        });

        it('does not treat a bare 429 as proof that the whole game API is unreachable', async () => {
            mockFetch.mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '60' } }));

            const client = createClient();
            await client.request('/test');

            expect(client.getServerHealth().reachable).toBe(true);
        });

        it('still rejects a non-JSON body on any other status', async () => {
            mockFetch.mockResolvedValueOnce(
                new Response('<html>err</html>', { status: 502, headers: { 'content-type': 'text/html' } }),
            );

            const client = createClient();
            await expect(client.request('/test')).rejects.toThrow(/non-JSON/i);
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

        it('clears only the game JWT and fails a read without replaying it after 401', async () => {
            const rejectedToken = 'rejected-token';
            const rejectedBody = { error: 'rejected-body' };
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(rejectedBody), { status: 401 }));

            const client = createClient();
            const authenticator = fakeAuthenticator(rejectedToken, 'fresh');
            client.setAuthenticator(authenticator);

            const failure = client.authenticatedRequest('/protected');

            await expect(failure).rejects.toMatchObject({
                data: { code: 'AUTHENTICATION_REQUIRED', stateCleared: true, nextTool: 'cpu_authenticate' },
            });
            await expect(failure).rejects.toBeInstanceOf(AuthenticationRequiredError);
            expect(authenticator.reauthenticate).not.toHaveBeenCalled();
            expect(mockSession.clearJwt).toHaveBeenCalledOnce();
            expect(mockFetch).toHaveBeenCalledTimes(1);
            await expect(failure).rejects.not.toThrow(rejectedToken);
            await expect(failure).rejects.not.toThrow('rejected-body');
        });

        it.each([
            ['an empty body', ''],
            ['a text body', 'rejected non-json body'],
        ])('clears the JWT before parsing a 401 with %s', async (_description, rejectedBody) => {
            const rejectedToken = 'rejected-token';
            mockFetch.mockResolvedValueOnce(
                new Response(rejectedBody, { status: 401, headers: { 'content-type': 'text/plain' } }),
            );

            const client = createClient();
            const authenticator = fakeAuthenticator(rejectedToken, 'fresh');
            client.setAuthenticator(authenticator);

            const failure = client.authenticatedRequest('/protected');

            await expect(failure).rejects.toMatchObject({
                data: { code: 'AUTHENTICATION_REQUIRED', stateCleared: true, nextTool: 'cpu_authenticate' },
            });
            await expect(failure).rejects.toBeInstanceOf(AuthenticationRequiredError);
            expect(mockSession.clearJwt).toHaveBeenCalledOnce();
            expect(mockFetch).toHaveBeenCalledOnce();
            await expect(failure).rejects.not.toThrow(rejectedToken);
            await expect(failure).rejects.not.toThrow(rejectedBody);
        });

        it('fails a write without replaying its body after 401', async () => {
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401 }));

            const client = createClient();
            const authenticator = fakeAuthenticator('stale', 'fresh');
            client.setAuthenticator(authenticator);

            await expect(
                client.authenticatedRequest('/protected', { method: 'POST', body: { amount: 1 } }),
            ).rejects.toBeInstanceOf(AuthenticationRequiredError);

            expect(authenticator.reauthenticate).not.toHaveBeenCalled();
            expect(mockSession.clearJwt).toHaveBeenCalledOnce();
            expect(mockFetch).toHaveBeenCalledTimes(1);
        });
    });
});
