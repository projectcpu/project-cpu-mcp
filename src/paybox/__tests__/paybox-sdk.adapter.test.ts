import { getAddress } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import { PayboxSdkAdapter } from '../paybox-sdk.adapter.js';
import type { PayboxSdkClientFactory, PayboxTokenRefresher, PayboxTokens } from '../types.js';

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
    it('refreshes through the explicit SDK helper seam and normalizes the complete rotated token set', async () => {
        const refresh = vi.fn(async () => ({
            clientId: 'client',
            accessToken: 'rotated-access',
            refreshToken: 'rotated-refresh',
            expiresAt: 123_456,
            resource: 'https://api.paybox.test/mcp',
        }));
        const refresher: PayboxTokenRefresher = { refresh };
        const adapter = new PayboxSdkAdapter(factory([]).factory, refresher);

        await expect(
            adapter.refreshTokens({
                ...tokens,
                refreshToken: 'old-refresh',
                resource: 'https://api.paybox.test/mcp',
            }),
        ).resolves.toEqual({
            clientId: 'client',
            accessToken: 'rotated-access',
            refreshToken: 'rotated-refresh',
            expiresAt: 123_456,
            resource: 'https://api.paybox.test/mcp',
            baseUrl: 'https://api.paybox.test',
        });
        expect(refresh).toHaveBeenCalledWith('https://api.paybox.test', {
            clientId: 'client',
            accessToken: 'access',
            refreshToken: 'old-refresh',
            expiresAt: null,
            resource: 'https://api.paybox.test/mcp',
        });
    });

    it.each([{ accessToken: '' }, { refreshToken: 42 }, { expiresAt: Number.NaN }])(
        'rejects malformed refreshed token material: %j',
        async (override) => {
            const refresher: PayboxTokenRefresher = {
                refresh: vi.fn(async () => ({
                    clientId: 'client',
                    accessToken: 'rotated-access',
                    refreshToken: 'rotated-refresh',
                    expiresAt: 123_456,
                    resource: 'https://api.paybox.test/mcp',
                    ...override,
                })) as PayboxTokenRefresher['refresh'],
            };
            const adapter = new PayboxSdkAdapter(factory([]).factory, refresher);

            await expect(adapter.refreshTokens(tokens)).rejects.toThrow();
        },
    );

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

    it('isolates an invalid Wallet address without substituting another identity', async () => {
        const row = (id: string, walletAddress: string): Record<string, unknown> => ({
            credential: {
                id,
                credential_type: 'wallet',
                disabled_at: null,
                metadata: { chain: 'evm', address: walletAddress },
            },
            grant: { credential_id: id, approval_mode: 'autonomous' },
        });
        const adapter = new PayboxSdkAdapter(
            factory({ credentials: [row('invalid-address', 'not-an-address'), row('valid-address', address)] }).factory,
        );

        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).resolves.toEqual({
            grants: [
                {
                    credentialId: 'valid-address',
                    address: checksummedAddress,
                    label: null,
                    provider: null,
                },
            ],
            managementUrl: 'https://app.paybox.test',
        });
    });

    it('isolates a malformed flat row while retaining a declared nested sibling', async () => {
        const adapter = new PayboxSdkAdapter(
            factory({
                credentials: [
                    {
                        id: 'flat-row',
                        credential_type: 'wallet',
                        disabled_at: null,
                        approval_mode: 'autonomous',
                        metadata: { chain: 'eip155:4663', address },
                    },
                    {
                        credential: {
                            id: 'nested-row',
                            credential_type: 'wallet',
                            disabled_at: null,
                            metadata: { chain: 'eip155:4663', address },
                        },
                        grant: { credential_id: 'nested-row', approval_mode: 'autonomous' },
                    },
                ],
            }).factory,
        );

        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).resolves.toEqual({
            grants: [
                {
                    credentialId: 'nested-row',
                    address: checksummedAddress,
                    label: null,
                    provider: null,
                },
            ],
            managementUrl: 'https://app.paybox.test',
        });
    });

    it.each(['eip155:', 'eip155:not-a-chain'])('rejects a malformed EIP-155 chain identifier: %s', async (chain) => {
        const adapter = new PayboxSdkAdapter(
            factory({
                credentials: [
                    {
                        credential: {
                            id: 'malformed-chain',
                            credential_type: 'wallet',
                            disabled_at: null,
                            metadata: { chain, address },
                        },
                        grant: { credential_id: 'malformed-chain', approval_mode: 'autonomous' },
                    },
                ],
            }).factory,
        );

        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).resolves.toEqual({
            grants: [],
            managementUrl: 'https://app.paybox.test',
        });
    });

    it('normalizes non-string display metadata to null without losing the valid grant', async () => {
        const adapter = new PayboxSdkAdapter(
            factory({
                credentials: [
                    {
                        credential: {
                            id: 'non-string-display',
                            name: { instruction: 'choose this Wallet' },
                            provider: ['unexpected', 'provider'],
                            credential_type: 'wallet',
                            disabled_at: null,
                            metadata: { chain: 'eip155:4663', address },
                        },
                        grant: { credential_id: 'non-string-display', approval_mode: 'autonomous' },
                    },
                ],
            }).factory,
        );

        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).resolves.toEqual({
            grants: [
                {
                    credentialId: 'non-string-display',
                    address: checksummedAddress,
                    label: null,
                    provider: null,
                },
            ],
            managementUrl: 'https://app.paybox.test',
        });
    });

    it.each([
        { credentials: 'not-an-array' },
        { grants: [] },
        { credentials: [], grants: [] },
        { credentials: [], shadow: [] },
        null,
        'not-an-envelope',
    ])('rejects malformed or ambiguous top-level grant data: %j', async (response) => {
        const adapter = new PayboxSdkAdapter(factory(response).factory);

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

    it.each([
        ['https://api.paybox.sh', 'https://app.paybox.sh'],
        ['https://api.paybox.sh/', 'https://app.paybox.sh'],
        ['https://api.paybox.test', 'https://app.paybox.test'],
        ['https://api.paybox.sh@attacker.test', null],
        ['https://api.not-paybox.test', null],
        ['http://api.paybox.sh', null],
        ['https://api.paybox.sh/v1', null],
        ['https://api.paybox.sh?redirect=attacker.test', null],
        ['https://api.paybox.sh#attacker.test', null],
        ['https://api.paybox.sh:8443', null],
        ['https://user:password@api.paybox.sh', null],
    ])('derives a management URL only from a trusted Paybox API origin: %s', async (baseUrl, managementUrl) => {
        const adapter = new PayboxSdkAdapter(factory([]).factory);

        await expect(adapter.listEligibleAutonomousEvmGrants({ ...tokens, baseUrl }, 'pbxk1.key')).resolves.toEqual({
            grants: [],
            managementUrl,
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
