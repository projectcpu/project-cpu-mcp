import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { apiSyndicateCardSchema, apiSyndicateMembershipSchema, apiSyndicateMemberViewSchema } from '../types.js';

function card(): unknown {
    return {
        id: '1',
        manager: '0x00000000000000000000000000000000000000a1',
        name: 'Iron Pact',
        link: 'https://example.test/iron',
        rates: { tradeDiscountBp: 250, transportDiscountBp: 500, tradeTaxBp: 100, transportTaxBp: 0 },
        memberCount: 3,
        createdAt: 1_700_000_000,
    };
}

describe('apiSyndicateCardSchema', () => {
    it('parses a card with int basis-point rates and a string id', () => {
        const parsed = apiSyndicateCardSchema.parse(card());
        expect(parsed.id).toBe('1');
        expect(parsed.rates.tradeDiscountBp).toBe(250);
        expect(parsed.createdAt).toBe(1_700_000_000);
    });

    it('rejects a card missing the required rates block (wire drift)', () => {
        const { rates: _dropped, ...noRates } = card() as Record<string, unknown>;
        expect(() => apiSyndicateCardSchema.parse(noRates)).toThrow();
    });

    it('rejects a fractional (non-int) basis-point rate', () => {
        const bad = {
            ...(card() as Record<string, unknown>),
            rates: { tradeDiscountBp: 2.5, transportDiscountBp: 0, tradeTaxBp: 0, transportTaxBp: 0 },
        };
        expect(() => apiSyndicateCardSchema.parse(bad)).toThrow();
    });

    it('does not parse a 404 error body as a card', () => {
        expect(() => apiSyndicateCardSchema.parse({ error: 'SyndicateNotFound', message: 'not found' })).toThrow();
    });

    it('tolerates additive fields the server may add later', () => {
        const parsed = apiSyndicateCardSchema.parse({ ...(card() as Record<string, unknown>), tier: 2 });
        expect(parsed.id).toBe('1');
    });
});

describe('apiSyndicateMemberViewSchema', () => {
    it('parses an empty members page (unknown id / past the end)', () => {
        expect(z.array(apiSyndicateMemberViewSchema).parse([])).toEqual([]);
    });

    it('parses members with a string address and a seconds timestamp', () => {
        const rows = z
            .array(apiSyndicateMemberViewSchema)
            .parse([{ address: '0x00000000000000000000000000000000000000b1', joinedAt: 1_700_000_100 }]);
        expect(rows[0]?.joinedAt).toBe(1_700_000_100);
    });
});

describe('apiSyndicateMembershipSchema', () => {
    it('parses a membership with seconds timestamps and a string syndicate id', () => {
        const parsed = apiSyndicateMembershipSchema.parse({
            syndicateId: '1',
            joinedAt: 1_700_000_000,
            leaveAvailableAt: 1_700_600_000,
        });
        expect(parsed.syndicateId).toBe('1');
        expect(parsed.leaveAvailableAt).toBe(1_700_600_000);
    });

    it('treats a null body as the non-member wire form via a nullable wrapper', () => {
        expect(apiSyndicateMembershipSchema.nullable().parse(null)).toBeNull();
    });
});
