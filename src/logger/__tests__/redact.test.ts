import { describe, expect, it } from 'vitest';

import { REDACTED } from '../constants.js';
import { redactString, redactValue } from '../redact.utils.js';

describe('redactString', () => {
    it('redacts raw 32-byte hex private keys', () => {
        const input = 'signing with 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 now';
        expect(redactString(input)).toBe(`signing with ${REDACTED} now`);
    });

    it('redacts JWT tokens', () => {
        const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signaturePart';
        expect(redactString(`Authorization: Bearer ${jwt}`)).toBe(`Authorization: Bearer ${REDACTED}`);
    });

    it('leaves non-sensitive text alone', () => {
        const input = 'ok: address=0xABC (short), chainId=2741';
        expect(redactString(input)).toBe(input);
    });

    it('redacts multiple secrets in one message', () => {
        const a = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
        const b = '0xbb0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';
        expect(redactString(`${a} then ${b}`)).toBe(`${REDACTED} then ${REDACTED}`);
    });
});

describe('redactValue', () => {
    it('redacts values whose key is in SENSITIVE_KEYS', () => {
        const input = { privateKey: '0xdeadbeef', user: 'alice' };
        expect(redactValue(input)).toEqual({ privateKey: REDACTED, user: 'alice' });
    });

    it('is case-insensitive on keys', () => {
        const input = { PRIVATE_KEY: 'x', JWT: 'y', RefreshToken: 'z' };
        expect(redactValue(input)).toEqual({
            PRIVATE_KEY: REDACTED,
            JWT: REDACTED,
            RefreshToken: REDACTED,
        });
    });

    it('recurses into nested objects', () => {
        const input = {
            session: {
                address: '0xABC',
                jwt: 'xxx',
            },
        };
        expect(redactValue(input)).toEqual({
            session: { address: '0xABC', jwt: REDACTED },
        });
    });

    it('recurses into arrays', () => {
        const input = { keys: [{ privateKey: 'a' }, { privateKey: 'b' }] };
        expect(redactValue(input)).toEqual({
            keys: [{ privateKey: REDACTED }, { privateKey: REDACTED }],
        });
    });

    it('scrubs 0x-hex and JWT patterns in string values', () => {
        const input = {
            note: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
        };
        expect(redactValue(input)).toEqual({ note: REDACTED });
    });

    it('leaves primitives and non-sensitive fields unchanged', () => {
        const input = { n: 42, ok: true, name: null };
        expect(redactValue(input)).toEqual(input);
    });

    it('redacts whole subtree when key matches, ignoring its inner shape', () => {
        const input = { secret: { nested: { deep: 'x' } } };
        expect(redactValue(input)).toEqual({ secret: REDACTED });
    });
});
