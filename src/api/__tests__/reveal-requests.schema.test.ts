import { describe, expect, it } from 'vitest';

import { apiOpenRevealRequestsSchema, apiRevealRequestSchema } from '../types.js';

function row(overrides: Record<string, unknown> = {}): unknown {
    return {
        requestId: '7',
        source: '0x00000000000000000000000000000000000000b1',
        tokenId: '4242',
        revealCount: 3,
        requestedAt: 1_700_000_000,
        ...overrides,
    };
}

describe('apiRevealRequestSchema', () => {
    it('parses a row with string ids and second timestamps', () => {
        const parsed = apiRevealRequestSchema.parse(row());

        expect(parsed.requestId).toBe('7');
        expect(parsed.tokenId).toBe('4242');
        expect(parsed.requestedAt).toBe(1_700_000_000);
    });

    it('renames the wire counter so it cannot be compared with a cell reveal count', () => {
        const parsed = apiRevealRequestSchema.parse(row({ revealCount: 3 }));

        expect(parsed).not.toHaveProperty('revealCount');
        expect(parsed.revealEpoch).toBe(3);
    });

    it('keeps the nulls of a row the server only ever saw closed', () => {
        const parsed = apiRevealRequestSchema.parse(row({ revealCount: null, requestedAt: null }));

        expect(parsed.revealEpoch).toBeNull();
        expect(parsed.requestedAt).toBeNull();
    });

    it('rejects a row without the source that identifies it together with the id', () => {
        const { source: _dropped, ...noSource } = row() as Record<string, unknown>;

        expect(() => apiRevealRequestSchema.parse(noSource)).toThrow();
    });

    it('rejects numeric ids, which lose precision on a large cell or request id', () => {
        expect(() => apiRevealRequestSchema.parse(row({ requestId: 7 }))).toThrow();
        expect(() => apiRevealRequestSchema.parse(row({ tokenId: 4242 }))).toThrow();
    });

    it('rejects a fractional request time', () => {
        expect(() => apiRevealRequestSchema.parse(row({ requestedAt: 1_700_000_000.5 }))).toThrow();
    });

    it('tolerates fields the server may add later', () => {
        const parsed = apiRevealRequestSchema.parse(row({ status: 'open' }));

        expect(parsed.requestId).toBe('7');
    });
});

describe('apiOpenRevealRequestsSchema', () => {
    it('parses the envelope of server time plus rows', () => {
        const parsed = apiOpenRevealRequestsSchema.parse({ serverTime: 1_700_000_500, requests: [row()] });

        expect(parsed.serverTime).toBe(1_700_000_500);
        expect(parsed.requests).toHaveLength(1);
    });

    it('parses an owner with nothing open', () => {
        const parsed = apiOpenRevealRequestsSchema.parse({ serverTime: 1_700_000_500, requests: [] });

        expect(parsed.requests).toEqual([]);
    });

    it('rejects an envelope without the server time the request age is measured against', () => {
        expect(() => apiOpenRevealRequestsSchema.parse({ requests: [] })).toThrow();
    });

    it('rejects an error body in place of the envelope', () => {
        expect(() => apiOpenRevealRequestsSchema.parse({ message: 'owner must not be empty' })).toThrow();
    });

    it('rejects a row that drifted inside an otherwise valid envelope', () => {
        expect(() =>
            apiOpenRevealRequestsSchema.parse({ serverTime: 1_700_000_500, requests: [row({ tokenId: null })] }),
        ).toThrow();
    });
});
