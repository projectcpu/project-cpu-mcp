import { getAddress } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { PayboxSdkAdapter } from '../paybox-sdk.adapter.js';
import type { PayboxSdkClientFactory, PayboxTokens } from '../types.js';

const tokens: PayboxTokens = {
    clientId: 'client',
    accessToken: 'access',
    refreshToken: null,
    expiresAt: null,
    resource: null,
    baseUrl: 'https://api.paybox.test',
};
const address = '0x59c6995e998f97a5a0044966f0945389dc9e86da';
const checksummedAddress = getAddress(address);

function factory(result: unknown): {
    factory: PayboxSdkClientFactory;
    list: ReturnType<typeof vi.fn>;
    sign: ReturnType<typeof vi.fn>;
} {
    const list = vi.fn(async () => result);
    const sign = vi.fn(async () => ({
        status: 'success',
        output: { output_type: 'signature', credential_id: 'credential-a', value: `0x${'a'.repeat(130)}` },
    }));
    return { factory: { create: vi.fn(() => ({ listCredentials: list, requestWalletSign: sign })) }, list, sign };
}

describe('PayboxSdkAdapter', () => {
    it('constructs an explicit client and selects the sole enabled autonomous EVM wallet', async () => {
        const mock = factory([
            {
                credential: {
                    id: 'credential-a',
                    credential_type: 'wallet',
                    disabled_at: null,
                    metadata: { chain: 'evm', address },
                },
                grant: { approval_mode: 'autonomous' },
            },
        ]);
        const adapter = new PayboxSdkAdapter(mock.factory);

        await expect(adapter.selectOneAutonomousEvmGrant(tokens, 'pbxk1.key')).resolves.toEqual({
            credentialId: 'credential-a',
            address: checksummedAddress,
        });
        expect(mock.factory.create).toHaveBeenCalledWith({
            baseUrl: tokens.baseUrl,
            token: tokens.accessToken,
            signingKey: 'pbxk1.key',
        });
    });

    it('rejects zero or multiple eligible grants instead of choosing one', async () => {
        const mock = factory([]);
        const adapter = new PayboxSdkAdapter(mock.factory);
        await expect(adapter.selectOneAutonomousEvmGrant(tokens, 'pbxk1.key')).rejects.toThrow('exactly one');

        mock.list.mockResolvedValueOnce([
            {
                credential: {
                    id: 'a',
                    credential_type: 'wallet',
                    disabled_at: null,
                    metadata: { chain: 'evm', address },
                },
                grant: { approval_mode: 'autonomous' },
            },
            {
                credential: {
                    id: 'b',
                    credential_type: 'wallet',
                    disabled_at: null,
                    metadata: { chain: 'eip155:4663', address },
                },
                grant: { approval_mode: 'autonomous' },
            },
        ]);
        await expect(adapter.selectOneAutonomousEvmGrant(tokens, 'pbxk1.key')).rejects.toThrow('exactly one');
    });

    it('passes the opaque credential ID explicitly and rejects non-success signature responses', async () => {
        const mock = factory([]);
        const adapter = new PayboxSdkAdapter(mock.factory);
        await adapter.signMessage(tokens, 'pbxk1.key', 'credential-a', 'hello');
        expect(mock.sign).toHaveBeenCalledWith(
            { credentialId: 'credential-a', intent: { op: 'message', message: 'hello' } },
            { autoSign: true },
        );

        mock.sign.mockResolvedValueOnce({ status: 'pending_signature', output: null });
        await expect(adapter.signMessage(tokens, 'pbxk1.key', 'credential-a', 'hello')).rejects.toThrow(
            'did not complete',
        );
        mock.sign.mockResolvedValueOnce({
            status: 'success',
            output: { output_type: 'signature', credential_id: 'other', value: `0x${'a'.repeat(130)}` },
        });
        await expect(adapter.signMessage(tokens, 'pbxk1.key', 'credential-a', 'hello')).rejects.toThrow(
            'invalid message signature',
        );
    });
});
