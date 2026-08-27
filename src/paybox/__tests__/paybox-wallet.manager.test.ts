import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../../api/client.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { AuthService } from '../../services/auth.service.js';
import type { SessionManager } from '../../session/manager.js';
import { SessionStatus } from '../../session/types.js';
import { PayboxWalletManager } from '../paybox-wallet.manager.js';
import type { IPayboxSdkAdapter, PayboxTokens } from '../types.js';

const key = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const account = privateKeyToAccount(key);
const tokens: PayboxTokens = {
    clientId: 'client',
    accessToken: 'access',
    refreshToken: null,
    expiresAt: null,
    resource: null,
    baseUrl: 'https://api.paybox.test',
};

function manager(signature: string): { wallet: PayboxWalletManager; sign: ReturnType<typeof vi.fn> } {
    const sign = vi.fn(async () => signature);
    const sdk = { signMessage: sign } as unknown as IPayboxSdkAdapter;
    return { wallet: new PayboxWalletManager(sdk, tokens, 'pbxk1.key', 'credential-a', account.address), sign };
}

describe('PayboxWalletManager', () => {
    it('returns only a valid EIP-191 signature bound to the selected wallet and credential', async () => {
        const message = 'Project CPU SIWE proof';
        const signature = await account.signMessage({ message });
        const result = manager(signature);

        await expect(result.wallet.signMessage(message)).resolves.toBe(signature);
        expect(result.sign).toHaveBeenCalledWith(tokens, 'pbxk1.key', 'credential-a', message);
        expect(result.wallet.getAddress()).toBe(account.address);
        expect(result.wallet.getChainId()).toBe(4663);
    });

    it('rejects wrong signer, wrong message, and malformed signatures before downstream use', async () => {
        const message = 'Project CPU SIWE proof';
        const other = privateKeyToAccount('0x8b3a350cf5c34c9194ca3a545d9b5d4a1f0abf1c9f3c2bb18ce19e6f01a82652');
        await expect(manager(await other.signMessage({ message })).wallet.signMessage(message)).rejects.toThrow(
            'does not match',
        );
        await expect(
            manager(await account.signMessage({ message: 'other' })).wallet.signMessage(message),
        ).rejects.toThrow('does not match');
        await expect(manager('0xdeadbeef').wallet.signMessage(message)).rejects.toThrow('malformed');
    });

    it('makes transaction operations explicit c02 failures', async () => {
        const result = manager(await account.signMessage({ message: 'm' }));
        await expect(result.wallet.getBalance()).rejects.toThrow('not available yet');
    });

    it('prevents SIWE verification when the selected-wallet signature check fails', async () => {
        const message = 'unused';
        const other = privateKeyToAccount('0x8b3a350cf5c34c9194ca3a545d9b5d4a1f0abf1c9f3c2bb18ce19e6f01a82652');
        const result = manager(await other.signMessage({ message }));
        const request = vi.fn(async () => ({
            status: 200,
            data: {
                nonce: 'abc123def456',
                issuedAt: new Date().toISOString(),
                expirationTime: new Date(Date.now() + 600_000).toISOString(),
            },
        }));
        const service = new AuthService({
            session: { getStatus: () => SessionStatus.Missing } as unknown as SessionManager,
            api: { getBaseUrl: () => 'https://api.test', request } as unknown as ApiClient,
            wallet: { get: () => result.wallet, isReady: () => true },
            logger: new NoopLogger(),
        });

        await expect(service.authenticateSiwe()).rejects.toThrow('does not match');
        expect(request).toHaveBeenCalledTimes(1);
    });
});
