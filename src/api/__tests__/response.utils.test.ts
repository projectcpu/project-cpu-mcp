import { describe, expect, it } from 'vitest';

import { parseJsonBody } from '../response.utils.js';

describe('parseJsonBody', () => {
    it('parses a valid JSON body', async () => {
        const parsed = await parseJsonBody<{ ok: boolean }>(
            new Response(JSON.stringify({ ok: true }), { status: 200 }),
        );
        expect(parsed).toEqual({ ok: true });
    });

    it('resolves an empty 2xx body to null (the wire shape of a "no content" answer)', async () => {
        const parsed = await parseJsonBody<unknown>(new Response('', { status: 200 }));
        expect(parsed).toBeNull();
    });

    it('resolves a whitespace-only 2xx body to null', async () => {
        const parsed = await parseJsonBody<unknown>(new Response('   \n', { status: 299 }));
        expect(parsed).toBeNull();
    });

    it('still throws a clear non-JSON error on a non-empty non-JSON 2xx body', async () => {
        await expect(
            parseJsonBody(new Response('<html>oops</html>', { status: 200, headers: { 'content-type': 'text/html' } })),
        ).rejects.toThrow(/non-JSON/i);
    });

    it('still throws a clear non-JSON error on an empty non-2xx body', async () => {
        await expect(parseJsonBody(new Response('', { status: 502 }))).rejects.toThrow(/non-JSON/i);
    });
});
