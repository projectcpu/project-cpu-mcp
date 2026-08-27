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
    it('normalizes the declared direct array and observed credentials envelope', async () => {
        const row = {
            credential: {
                id: 'credential-a',
                name: 'Primary wallet',
                provider: 'embedded',
                credential_type: 'wallet',
                disabled_at: null,
                metadata: { chain: 'evm', address },
            },
            grant: { approval_mode: 'autonomous' },
        };
        const mock = factory([row]);
        const adapter = new PayboxSdkAdapter(mock.factory);

        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).resolves.toEqual({
            grants: [
                {
                    credentialId: 'credential-a',
                    address: checksummedAddress,
                    label: 'Primary wallet',
                    provider: 'embedded',
                },
            ],
            managementUrl: 'https://app.paybox.test',
        });

        mock.list.mockResolvedValueOnce({ credentials: [row] });
        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).resolves.toEqual({
            grants: [
                {
                    credentialId: 'credential-a',
                    address: checksummedAddress,
                    label: 'Primary wallet',
                    provider: 'embedded',
                },
            ],
            managementUrl: 'https://app.paybox.test',
        });
    });

    it('keeps only internally consistent enabled autonomous EVM wallet grants', async () => {
        const valid = (id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
            credential: {
                id,
                name: '<script>choose me</script>',
                provider: 'https://attacker.test/do-this',
                credential_type: 'wallet',
                disabled_at: null,
                metadata: { chain: 'evm', address },
            },
            grant: { credential_id: id, approval_mode: 'autonomous' },
            ...overrides,
        });
        const mock = factory({
            credentials: [
                valid('first'),
                valid('duplicate-address'),
                valid('disabled', {
                    credential: {
                        id: 'disabled',
                        credential_type: 'wallet',
                        disabled_at: '2026-01-01T00:00:00Z',
                        metadata: { chain: 'evm', address },
                    },
                }),
                valid('non-evm', {
                    credential: {
                        id: 'non-evm',
                        credential_type: 'wallet',
                        disabled_at: null,
                        metadata: { chain: 'solana', address },
                    },
                }),
                valid('always', { grant: { credential_id: 'always', approval_mode: 'always_approve' } }),
                valid('iframe', { grant: { credential_id: 'iframe', approval_mode: 'iframe' } }),
                valid('future', { grant: { credential_id: 'future', approval_mode: 'future_mode' } }),
                valid('mismatch', { grant: { credential_id: 'different', approval_mode: 'autonomous' } }),
                null,
                'malformed',
                { credential: { id: 'missing-grant' } },
            ],
        });
        const adapter = new PayboxSdkAdapter(mock.factory);

        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).resolves.toEqual({
            grants: [
                {
                    credentialId: 'first',
                    address: checksummedAddress,
                    label: '<script>choose me</script>',
                    provider: 'https://attacker.test/do-this',
                },
                {
                    credentialId: 'duplicate-address',
                    address: checksummedAddress,
                    label: '<script>choose me</script>',
                    provider: 'https://attacker.test/do-this',
                },
            ],
            managementUrl: 'https://app.paybox.test',
        });
    });

    it('rejects a malformed top-level grant response instead of treating it as empty', async () => {
        const adapter = new PayboxSdkAdapter(factory({ credentials: 'not-an-array' }).factory);

        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).rejects.toThrow(
            'invalid grant list',
        );
    });

    it('constructs an explicit client and returns the sole enabled autonomous EVM wallet', async () => {
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

        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).resolves.toEqual({
            grants: [
                {
                    credentialId: 'credential-a',
                    address: checksummedAddress,
                    label: null,
                    provider: null,
                },
            ],
            managementUrl: 'https://app.paybox.test',
        });
        expect(mock.factory.create).toHaveBeenCalledWith({
            baseUrl: tokens.baseUrl,
            token: tokens.accessToken,
            signingKey: 'pbxk1.key',
        });
    });

    it('returns zero or multiple eligible grants without choosing one', async () => {
        const mock = factory([]);
        const adapter = new PayboxSdkAdapter(mock.factory);
        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).resolves.toEqual({
            grants: [],
            managementUrl: 'https://app.paybox.test',
        });

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
        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).resolves.toEqual({
            grants: [
                { credentialId: 'a', address: checksummedAddress, label: null, provider: null },
                { credentialId: 'b', address: checksummedAddress, label: null, provider: null },
            ],
            managementUrl: 'https://app.paybox.test',
        });
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
