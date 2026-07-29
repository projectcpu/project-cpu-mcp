import { verifyMessage } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../logger/noop.logger.js';
import { EvmWalletManager } from '../evm.manager.js';

const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const EXPECTED_ADDRESS = privateKeyToAccount(TEST_KEY).address;

function createManager(chainId = 1): EvmWalletManager {
    return new EvmWalletManager({ privateKey: TEST_KEY, chainId, rpcUrl: null, logger: new NoopLogger() });
}

describe('EvmWalletManager', () => {
    it('getAddress returns the address derived from the private key', () => {
        expect(createManager().getAddress()).toBe(EXPECTED_ADDRESS);
    });

    it('getChainId returns the configured chain id', () => {
        expect(createManager(8453).getChainId()).toBe(8453);
    });

    it('signMessage produces a signature recoverable to the wallet address', async () => {
        const manager = createManager();
        const message = 'hello project cpu';

        const signature = await manager.signMessage(message);

        expect(signature).toMatch(/^0x[0-9a-fA-F]+$/);
        const valid = await verifyMessage({ address: EXPECTED_ADDRESS, message, signature });
        expect(valid).toBe(true);
    });

    it('throws at construction for an unsupported chainId', () => {
        expect(() => createManager(999999)).toThrow(/unsupported chainid/i);
    });
});
