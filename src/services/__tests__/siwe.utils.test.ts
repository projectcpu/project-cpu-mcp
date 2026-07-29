import { privateKeyToAccount } from 'viem/accounts';
import { parseSiweMessage } from 'viem/siwe';
import { describe, expect, it } from 'vitest';

import { buildSiweMessage } from '../siwe.utils.js';

const ADDRESS = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d').address;

describe('buildSiweMessage', () => {
    const baseInput = {
        address: ADDRESS,
        chainId: 1,
        apiUrl: 'https://api.project-cpu.com',
        nonce: 'abc123nonce',
        issuedAt: '2026-05-29T10:00:00.000Z',
        expirationTime: '2026-05-29T10:10:00.000Z',
    };

    it('produces a message that parses back to the same fields', () => {
        const parsed = parseSiweMessage(buildSiweMessage(baseInput));

        expect(parsed.address).toBe(ADDRESS);
        expect(parsed.nonce).toBe('abc123nonce');
        expect(parsed.chainId).toBe(1);
        expect(parsed.domain).toBe('api.project-cpu.com');
        expect(parsed.uri).toBe('https://api.project-cpu.com');
    });

    it('derives domain (host) and uri (origin) from the API URL with a port', () => {
        const parsed = parseSiweMessage(buildSiweMessage({ ...baseInput, apiUrl: 'http://localhost:3000' }));

        expect(parsed.domain).toBe('localhost:3000');
        expect(parsed.uri).toBe('http://localhost:3000');
    });
});
