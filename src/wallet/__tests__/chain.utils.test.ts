import { robinhood } from 'viem/chains';
import { describe, expect, it } from 'vitest';

import { chainIdForNetwork } from '../../config/network.utils.js';
import { Network } from '../../config/types.js';
import { viemChainForChainId } from '../chain.utils.js';

describe('viemChainForChainId', () => {
    it('maps each supported chainId to its viem chain', () => {
        for (const id of [1, 11155111, 8453, 84532, 4663]) {
            expect(viemChainForChainId(id).id).toBe(id);
        }
    });

    it('resolves every network the config table knows', () => {
        for (const network of Object.values(Network)) {
            expect(() => viemChainForChainId(chainIdForNetwork(network))).not.toThrow();
        }
    });

    it('takes the Robinhood definition from viem rather than a local copy', () => {
        expect(viemChainForChainId(chainIdForNetwork(Network.ROBINHOOD))).toBe(robinhood);
    });

    it('throws for an unsupported chainId', () => {
        expect(() => viemChainForChainId(999999)).toThrow(/unsupported chainid/i);
    });
});
