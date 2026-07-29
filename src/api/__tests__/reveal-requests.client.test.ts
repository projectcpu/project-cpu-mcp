import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NoopLogger } from '../../logger/noop.logger.js';
import type { SessionManager } from '../../session/manager.js';
import { ApiClient } from '../client.js';
import { RevealRequestsClient } from '../reveal-requests.client.js';

const logger = new NoopLogger();

const OWNER = '0x00000000000000000000000000000000000000a1';
const WIRE_SOURCE = '0x9fe46736679d2d9a65f0992f2272de9f3c7fa6e0';
const CHECKSUMMED_SOURCE = '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0';

function openRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        requestId: '7',
        source: WIRE_SOURCE,
        tokenId: '4242',
        revealCount: 3,
        requestedAt: 1_700_000_000,
        ...overrides,
    };
}

function answer(requests: Array<Record<string, unknown>>, serverTime = 1_700_000_500): Response {
    return new Response(JSON.stringify({ serverTime, requests }), { status: 200 });
}

function createReader(): RevealRequestsClient {
    const api = new ApiClient({ baseUrl: 'https://api.test.com', session: {} as SessionManager, logger });
    return new RevealRequestsClient({ api, logger });
}

function requestedUrl(mock: ReturnType<typeof vi.fn>): URL {
    return new URL(String(mock.mock.calls[0]?.[0]));
}

describe('RevealRequestsClient', () => {
    const mockFetch = vi.fn();

    beforeEach(() => {
        vi.stubGlobal('fetch', mockFetch);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('owner scoping', () => {
        it('reads open requests scoped to the owner address', async () => {
            mockFetch.mockResolvedValueOnce(answer([openRequest()]));

            await createReader().listOpenRequests(OWNER);

            expect(mockFetch).toHaveBeenCalledWith(
                `https://api.test.com/api/v1/reveal/requests?owner=${OWNER}`,
                expect.objectContaining({ method: 'GET' }),
            );
        });

        it("refuses a blank owner instead of asking for every player's open requests", async () => {
            const reader = createReader();

            await expect(reader.listOpenRequests('')).rejects.toThrow(/owner address/i);
            await expect(reader.listOpenRequests('   ')).rejects.toThrow(/owner address/i);
            expect(mockFetch).not.toHaveBeenCalled();
        });

        it('sends the owner trimmed, exactly as the single query parameter', async () => {
            mockFetch.mockResolvedValueOnce(answer([]));

            await createReader().listOpenRequests(`  ${OWNER}  `);

            const url = requestedUrl(mockFetch);
            expect(url.pathname).toBe('/api/v1/reveal/requests');
            expect([...url.searchParams]).toEqual([['owner', OWNER]]);
        });

        it('asks for no sort and no ceiling of its own — the server fixes both', async () => {
            mockFetch.mockResolvedValueOnce(answer([]));

            await createReader().listOpenRequests(OWNER);

            const url = requestedUrl(mockFetch);
            expect(url.searchParams.has('sort')).toBe(false);
            expect(url.searchParams.has('limit')).toBe(false);
            expect(url.searchParams.has('offset')).toBe(false);
            expect(url.searchParams.has('status')).toBe(false);
        });
    });

    describe('answer', () => {
        it('never surfaces the request reveal counter, which is not the cell counter', async () => {
            mockFetch.mockResolvedValueOnce(answer([openRequest({ revealCount: 3 })]));

            const { requests } = await createReader().listOpenRequests(OWNER);

            expect(requests[0]).not.toHaveProperty('revealCount');
            expect(requests[0]).not.toHaveProperty('revealEpoch');
            expect(requests[0]).not.toHaveProperty('epoch');
            expect(Object.keys(requests[0] ?? {}).sort()).toEqual(['requestId', 'requestedAt', 'source', 'tokenId']);
        });

        it('carries the identifier, the source address, the cell and the request time of each row', async () => {
            mockFetch.mockResolvedValueOnce(answer([openRequest()]));

            const { requests } = await createReader().listOpenRequests(OWNER);

            expect(requests).toEqual([
                { requestId: '7', source: CHECKSUMMED_SOURCE, tokenId: '4242', requestedAt: 1_700_000_000 },
            ]);
        });

        it('checksums the lower-case source the server sends, so it compares against an on-chain address', async () => {
            mockFetch.mockResolvedValueOnce(answer([openRequest({ source: WIRE_SOURCE })]));

            const { requests } = await createReader().listOpenRequests(OWNER);

            expect(requests[0]?.source).toBe(CHECKSUMMED_SOURCE);
        });

        it('throws on a source that is not an address rather than passing it on to a comparison', async () => {
            mockFetch.mockResolvedValueOnce(answer([openRequest({ source: '0xnotanaddress' })]));

            await expect(createReader().listOpenRequests(OWNER)).rejects.toThrow();
        });

        it('carries the server time of the same answer, so request age needs no local clock', async () => {
            mockFetch.mockResolvedValueOnce(answer([openRequest()], 1_700_000_900));

            const view = await createReader().listOpenRequests(OWNER);

            expect(view.serverTime).toBe(1_700_000_900);
        });

        it('keeps the order the server answered in', async () => {
            mockFetch.mockResolvedValueOnce(
                answer([
                    openRequest({ requestId: '9', requestedAt: 1_700_000_200 }),
                    openRequest({ requestId: '4', requestedAt: 1_700_000_100 }),
                ]),
            );

            const { requests } = await createReader().listOpenRequests(OWNER);

            expect(requests.map((request) => request.requestId)).toEqual(['9', '4']);
        });

        it('reads an owner with nothing open as an empty list, not as a failure', async () => {
            mockFetch.mockResolvedValueOnce(answer([]));

            const view = await createReader().listOpenRequests(OWNER);

            expect(view.requests).toEqual([]);
            expect(view.serverTime).toBe(1_700_000_500);
        });

        it('keeps a row whose request time the server never learned', async () => {
            mockFetch.mockResolvedValueOnce(answer([openRequest({ requestedAt: null, revealCount: null })]));

            const { requests } = await createReader().listOpenRequests(OWNER);

            expect(requests[0]?.requestedAt).toBeNull();
        });

        it('throws on a non-200 answer instead of reporting no open requests', async () => {
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ message: 'bad owner' }), { status: 400 }));

            await expect(createReader().listOpenRequests(OWNER)).rejects.toThrow(/open reveal requests/i);
        });

        it('carries the reason the server gave for refusing, not just the status code', async () => {
            mockFetch.mockResolvedValueOnce(
                new Response(JSON.stringify({ success: false, error: 'BadRequest', message: 'bad owner' }), {
                    status: 400,
                }),
            );

            await expect(createReader().listOpenRequests(OWNER)).rejects.toThrow(/400.*bad owner/is);
        });

        it('throws when the answer drifts out of the expected shape', async () => {
            mockFetch.mockResolvedValueOnce(new Response(JSON.stringify({ requests: [] }), { status: 200 }));

            await expect(createReader().listOpenRequests(OWNER)).rejects.toThrow();
        });
    });
});
