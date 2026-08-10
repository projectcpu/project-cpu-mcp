import { describe, expect, it } from 'vitest';

import { chainIdForNetwork } from '../../config/network.utils.js';
import { Network } from '../../config/types.js';
import { universalRouterAddress, v4QuoterAddress } from '../uniswap.utils.js';

describe('universalRouterAddress', () => {
    it('resolves a router for every supported network', () => {
        for (const network of Object.values(Network)) {
            expect(universalRouterAddress(chainIdForNetwork(network))).toMatch(/^0x[0-9a-fA-F]{40}$/);
        }
    });

    it('falls back to a newer version on a chain without 2.0', () => {
        expect(universalRouterAddress(chainIdForNetwork(Network.ROBINHOOD)).toLowerCase()).toBe(
            '0x8876789976decbfcbbbe364623c63652db8c0904',
        );
    });

    it('keeps the 2.0 router where it is deployed', () => {
        expect(universalRouterAddress(chainIdForNetwork(Network.BASE)).toLowerCase()).toBe(
            '0x6ff5693b99212da76ad316178a184ab56d299b43',
        );
    });

    it('throws for a chain with no deployment', () => {
        expect(() => universalRouterAddress(1337)).toThrow(/not available for chainId 1337/);
    });
});

describe('v4QuoterAddress', () => {
    it('resolves a quoter for every supported network', () => {
        for (const network of Object.values(Network)) {
            expect(v4QuoterAddress(chainIdForNetwork(network))).toMatch(/^0x[0-9a-fA-F]{40}$/);
        }
    });

    it('throws for a chain without v4', () => {
        expect(() => v4QuoterAddress(1337)).toThrow(/not deployed for chainId 1337/);
    });
});
