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
