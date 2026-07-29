import { getAddress, type Address } from 'viem';
import { describe, expect, it } from 'vitest';

import { FulfilmentClaims } from '../claims.js';

const SOURCE = getAddress('0xabc1230000000000000000000000000000000001');
const LOWERCASE_SOURCE = SOURCE.toLowerCase() as Address;
const OTHER_SOURCE = getAddress('0x00000000000000000000000000000000000000b2');

describe('FulfilmentClaims', () => {
    it('hands the pair to the first caller and refuses the second', () => {
        const claims = new FulfilmentClaims();

        expect(claims.claim(SOURCE, 7n)).toBe(true);
        expect(claims.claim(SOURCE, 7n)).toBe(false);
        expect(claims.has(SOURCE, 7n)).toBe(true);
    });

    it('hands the pair back out once released', () => {
        const claims = new FulfilmentClaims();

        claims.claim(SOURCE, 7n);
        claims.release(SOURCE, 7n);

        expect(claims.has(SOURCE, 7n)).toBe(false);
        expect(claims.claim(SOURCE, 7n)).toBe(true);
    });

    it('reads the same pair through addresses that differ only in case', () => {
        const claims = new FulfilmentClaims();

        claims.claim(SOURCE, 7n);

        expect(SOURCE).not.toBe(LOWERCASE_SOURCE);
        expect(claims.claim(LOWERCASE_SOURCE, 7n)).toBe(false);
        expect(claims.has(LOWERCASE_SOURCE, 7n)).toBe(true);
    });

    it('keeps request ids apart per source, since ids start over at a new one', () => {
        const claims = new FulfilmentClaims();

        claims.claim(SOURCE, 7n);

        expect(claims.claim(OTHER_SOURCE, 7n)).toBe(true);
        expect(claims.claim(SOURCE, 8n)).toBe(true);
    });
});
