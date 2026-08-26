import { describe, expect, it } from 'vitest';

import { loadEnvConfig } from '../env.js';
import { Network } from '../types.js';

const PRIVATE_KEY = `0x${'11'.repeat(32)}`;

describe('loadEnvConfig NETWORK', () => {
    it('defaults to the Robinhood launch network', () => {
        expect(loadEnvConfig({ PRIVATE_KEY }).NETWORK).toBe(Network.ROBINHOOD);
    });

    it('accepts Robinhood explicitly', () => {
        expect(loadEnvConfig({ PRIVATE_KEY, NETWORK: Network.ROBINHOOD }).NETWORK).toBe(Network.ROBINHOOD);
    });

    it.each([Network.ETHEREUM, Network.ETHEREUM_SEPOLIA, Network.BASE, Network.BASE_SEPOLIA])(
        'rejects unsupported launch network %s',
        (network) => {
            expect(() => loadEnvConfig({ PRIVATE_KEY, NETWORK: network })).toThrow(/NETWORK/);
        },
    );
});

describe('loadEnvConfig PRIVATE_KEY', () => {
    it('rejects a startup without a private key', () => {
        expect(() => loadEnvConfig({})).toThrow(/PRIVATE_KEY/);
    });

    it('rejects a malformed private key', () => {
        expect(() => loadEnvConfig({ PRIVATE_KEY: '0xdeadbeef' })).toThrow(/PRIVATE_KEY/);
    });
});

describe('loadEnvConfig shape', () => {
    it('carries exactly the variables the runtime reads', () => {
        expect(Object.keys(loadEnvConfig({ PRIVATE_KEY })).sort()).toEqual([
            'API_URL',
            'NETWORK',
            'OPERATOR_PERSONA',
            'PRIVATE_KEY',
            'RPC_URL',
        ]);
    });
});

describe('loadEnvConfig RPC_URL', () => {
    it('is null when the override is absent', () => {
        expect(loadEnvConfig({ PRIVATE_KEY }).RPC_URL).toBeNull();
    });

    it('keeps an explicit override', () => {
        expect(loadEnvConfig({ PRIVATE_KEY, RPC_URL: 'https://rpc.example/robinhood' }).RPC_URL).toBe(
            'https://rpc.example/robinhood',
        );
    });
});

describe('loadEnvConfig OPERATOR_PERSONA', () => {
    it('is on when the variable is absent', () => {
        expect(loadEnvConfig({ PRIVATE_KEY }).OPERATOR_PERSONA).toBe(true);
    });

    it('is off on an explicit false, whatever the casing', () => {
        expect(loadEnvConfig({ PRIVATE_KEY, OPERATOR_PERSONA: 'false' }).OPERATOR_PERSONA).toBe(false);
        expect(loadEnvConfig({ PRIVATE_KEY, OPERATOR_PERSONA: '  FALSE ' }).OPERATOR_PERSONA).toBe(false);
    });

    it('stays on for true and for a value it cannot read', () => {
        expect(loadEnvConfig({ PRIVATE_KEY, OPERATOR_PERSONA: 'true' }).OPERATOR_PERSONA).toBe(true);
        expect(loadEnvConfig({ PRIVATE_KEY, OPERATOR_PERSONA: '0' }).OPERATOR_PERSONA).toBe(true);
        expect(loadEnvConfig({ PRIVATE_KEY, OPERATOR_PERSONA: 'nope' }).OPERATOR_PERSONA).toBe(true);
    });
});
