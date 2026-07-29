import { describe, expect, it } from 'vitest';

import { chainIdForNetwork } from '../network.utils.js';
import { Network } from '../types.js';

describe('chainIdForNetwork', () => {
    it('routes each network to its EVM chainId', () => {
        expect(chainIdForNetwork(Network.ETHEREUM)).toBe(1);
        expect(chainIdForNetwork(Network.ETHEREUM_SEPOLIA)).toBe(11155111);
        expect(chainIdForNetwork(Network.BASE)).toBe(8453);
        expect(chainIdForNetwork(Network.BASE_SEPOLIA)).toBe(84532);
        expect(chainIdForNetwork(Network.ROBINHOOD)).toBe(4663);
    });

    it('covers every network in the enum', () => {
        for (const network of Object.values(Network)) {
            expect(chainIdForNetwork(network)).toBeTypeOf('number');
        }
    });
});
