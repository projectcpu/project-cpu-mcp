import { PayboxError } from '@paybox-sh/sdk';
import { getAddress, parseEther } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import type { ILogger } from '../../logger/types.js';
import {
    PayboxAuthInvalidError,
    PayboxInvalidOperationArtifactError,
    PayboxOperationDeniedError,
    PayboxOperationIncompleteError,
    PayboxTemporarilyUnavailableError,
} from '../errors.js';
import { PayboxSdkAdapter } from '../sdk/adapter.js';
import { defaultPayboxTokenRefresher } from '../sdk/factory.js';
import type { PayboxSdkClientFactory, PayboxTokenRefresher, PayboxTokens, PayboxTransactionIntent } from '../types.js';

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
const signingIntent: PayboxTransactionIntent = {
    to: '0x0000000000000000000000000000000000000001',
    value: 0n,
    data: '0x',
    chainId: 4663,
    gas: 21_000n,
    maxPriorityFeePerGas: 1n,
    maxFeePerGas: 2n,
    nonce: 0,
};

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

function recordingLogger(): { logger: ILogger; warn: ReturnType<typeof vi.fn> } {
    const warn = vi.fn();
    const logger: ILogger = {
        info: vi.fn(),
        warn,
        error: vi.fn(),
        debug: vi.fn(),
        child: vi.fn(() => logger),
    };
    return { logger, warn };
}

describe('PayboxSdkAdapter', () => {
    it('logs safe SDK diagnostics when authenticated credential discovery fails unexpectedly', async () => {
        const mock = factory([]);
        const diagnostics = recordingLogger();
        mock.list.mockRejectedValueOnce(
            new PayboxError(
                422,
                JSON.stringify({ error: 'The signing key is not registered for this client.', access_token: 'secret' }),
                'GET /agent/credentials',
            ),
        );
        const adapter = new PayboxSdkAdapter(mock.factory, defaultPayboxTokenRefresher, {
            rpcUrl: null,
            logger: diagnostics.logger,
        });

        const failure = adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key');

        await expect(failure).rejects.toBeInstanceOf(PayboxOperationIncompleteError);
        await expect(failure).rejects.toMatchObject({
            data: {
                code: 'PAYBOX_OPERATION_INCOMPLETE',
                stateCleared: false,
                retryable: false,
                providerStatus: 422,
                providerMessage: 'The signing key is not registered for this client.',
            },
        });
        await expect(failure).rejects.not.toThrow('secret');
        expect(diagnostics.warn).toHaveBeenCalledOnce();
        expect(diagnostics.warn).toHaveBeenCalledWith('Paybox SDK operation failed', {
            operation: 'list_eligible_autonomous_evm_grants',
            stage: 'list_credentials',
            requestContext: 'authenticated',
            errorName: 'PayboxError',
            errorMessage: null,
            httpStatus: 422,
            classifiedErrorName: 'PayboxOperationIncompleteError',
        });
        expect(JSON.stringify(diagnostics.warn.mock.calls)).not.toContain('secret');
        expect(mock.list).toHaveBeenCalledOnce();
    });

    it('distinguishes malformed credential data from a failed SDK request', async () => {
        const mock = factory({ credentials: 'not-an-array' });
        const diagnostics = recordingLogger();
        const adapter = new PayboxSdkAdapter(mock.factory, defaultPayboxTokenRefresher, {
            rpcUrl: null,
            logger: diagnostics.logger,
        });

        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).rejects.toBeInstanceOf(
            PayboxOperationIncompleteError,
        );
        expect(diagnostics.warn).toHaveBeenCalledWith('Paybox SDK operation failed', {
            operation: 'list_eligible_autonomous_evm_grants',
            stage: 'normalize_credentials',
            requestContext: 'authenticated',
            errorName: 'Error',
            errorMessage: 'Paybox returned an invalid grant list.',
            httpStatus: null,
            classifiedErrorName: 'PayboxOperationIncompleteError',
        });
    });

    it('classifies an untyped SDK signing failure without exposing or replaying it', async () => {
        const mock = factory([]);
        mock.sign.mockRejectedValueOnce(new Error('unknown SDK failure with access_token=secret'));
        const adapter = new PayboxSdkAdapter(mock.factory);

        const failure = adapter.signMessage(tokens, 'pbxk1.key', 'credential-a', 'hello');

        await expect(failure).rejects.toBeInstanceOf(PayboxOperationIncompleteError);
        await expect(failure).rejects.toMatchObject({
            data: {
                code: 'PAYBOX_OPERATION_INCOMPLETE',
                stateCleared: false,
                retryable: false,
                providerStatus: null,
                providerMessage: 'unknown SDK failure with [REDACTED]',
            },
        });
        await expect(failure).rejects.not.toThrow('secret');
        expect(mock.sign).toHaveBeenCalledOnce();
    });

    it.each([
        [
            'message pending result',
            { status: 'pending_signature', output: null },
            (adapter: PayboxSdkAdapter) => adapter.signMessage(tokens, 'pbxk1.key', 'credential-a', 'hello'),
            PayboxOperationIncompleteError,
            'PAYBOX_OPERATION_INCOMPLETE',
            'operation_incomplete',
        ],
        [
            'message unknown result',
            { status: 'future_status', output: null },
            (adapter: PayboxSdkAdapter) => adapter.signMessage(tokens, 'pbxk1.key', 'credential-a', 'hello'),
            PayboxOperationIncompleteError,
            'PAYBOX_OPERATION_INCOMPLETE',
            'operation_incomplete',
        ],
        [
            'message malformed success artifact',
            { status: 'success', output: { output_type: 'signature', credential_id: 'other', value: 'not-hex' } },
            (adapter: PayboxSdkAdapter) => adapter.signMessage(tokens, 'pbxk1.key', 'credential-a', 'hello'),
            PayboxInvalidOperationArtifactError,
            'PAYBOX_INVALID_OPERATION_ARTIFACT',
            'invalid_operation_artifact',
        ],
        [
            'transaction pending result',
            { status: 'pending_signature', output: null },
            (adapter: PayboxSdkAdapter) => adapter.signTransaction(tokens, 'pbxk1.key', 'credential-a', signingIntent),
            PayboxOperationIncompleteError,
            'PAYBOX_OPERATION_INCOMPLETE',
            'operation_incomplete',
        ],
        [
            'transaction malformed success artifact',
            { status: 'success', output: { output_type: 'signature', credential_id: 'other', value: 'not-hex' } },
            (adapter: PayboxSdkAdapter) => adapter.signTransaction(tokens, 'pbxk1.key', 'credential-a', signingIntent),
            PayboxInvalidOperationArtifactError,
            'PAYBOX_INVALID_OPERATION_ARTIFACT',
            'invalid_operation_artifact',
        ],
    ])(
        'classifies %s without invalidating or resubmitting',
        async (_case, response, request, ErrorClass, code, failureClass) => {
            const mock = factory([]);
            mock.sign.mockResolvedValueOnce(response);
            const adapter = new PayboxSdkAdapter(mock.factory);

            const failure = request(adapter);

            await expect(failure).rejects.toBeInstanceOf(ErrorClass);
            await expect(failure).rejects.toMatchObject({
                data: { code, stateCleared: false, retryable: false },
                diagnostic: { failureClass, resetCause: null, resetDepth: 'none' },
            });
            await expect(failure).rejects.not.toBeInstanceOf(PayboxAuthInvalidError);
            expect(mock.sign).toHaveBeenCalledOnce();
        },
    );

    it.each([
        ['message', (adapter: PayboxSdkAdapter) => adapter.signMessage(tokens, 'pbxk1.key', 'credential-a', 'hello')],
        [
            'transaction',
            (adapter: PayboxSdkAdapter) => adapter.signTransaction(tokens, 'pbxk1.key', 'credential-a', signingIntent),
        ],
    ])('classifies an ordinary denied %s exactly once without invalidating authority', async (_kind, request) => {
        const mock = factory([]);
        mock.sign.mockResolvedValueOnce({ status: 'denied', output: null });
        const adapter = new PayboxSdkAdapter(mock.factory);

        const failure = request(adapter);

        await expect(failure).rejects.toBeInstanceOf(PayboxOperationDeniedError);
        await expect(failure).rejects.toMatchObject({
            data: { code: 'PAYBOX_OPERATION_DENIED' },
            diagnostic: {
                failureClass: 'operation_denied',
                resetCause: null,
                resetDepth: 'none',
            },
        });
        await expect(failure).rejects.not.toBeInstanceOf(PayboxAuthInvalidError);
        expect(mock.sign).toHaveBeenCalledOnce();
    });

    it.each([
        ['HTTP 429', new PayboxError(429, 'rate body secret', 'POST /agent/wallet-sign')],
        ['HTTP 503', new PayboxError(503, 'outage body secret', 'POST /agent/wallet-sign')],
        ['network failure', new TypeError('fetch failed with access_token=secret')],
        ['timeout', new DOMException('request timed out with refresh_token=secret', 'TimeoutError')],
    ])('classifies %s as temporary exactly once without exposing its raw cause', async (_case, error) => {
        const mock = factory([]);
        mock.sign.mockRejectedValueOnce(error);
        const adapter = new PayboxSdkAdapter(mock.factory);

        const failure = adapter.signTransaction(tokens, 'pbxk1.key', 'credential-a', signingIntent);

        await expect(failure).rejects.toBeInstanceOf(PayboxTemporarilyUnavailableError);
        await expect(failure).rejects.toMatchObject({
            data: {
                code: 'PAYBOX_TEMPORARILY_UNAVAILABLE',
                stateCleared: false,
                retryable: true,
            },
            diagnostic: {
                failureClass: 'temporarily_unavailable',
                resetCause: null,
                resetDepth: 'none',
            },
        });
        await expect(failure).rejects.not.toThrow('secret');
        await expect(failure).rejects.not.toBeInstanceOf(PayboxAuthInvalidError);
        expect(mock.sign).toHaveBeenCalledOnce();
    });

    it.each([401, 403])('classifies authenticated Paybox HTTP %i as confirmed invalid authority', async (status) => {
        const mock = factory([]);
        mock.list.mockRejectedValueOnce(new PayboxError(status, 'raw-body-secret', 'GET /agent/credentials'));
        const adapter = new PayboxSdkAdapter(mock.factory);

        const failure = adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key');

        await expect(failure).rejects.toBeInstanceOf(PayboxAuthInvalidError);
        await expect(failure).rejects.toMatchObject({
            diagnostic: {
                failureClass: 'confirmed_authentication',
                resetCause: 'authenticated_request_rejected',
                resetDepth: 'full',
            },
        });
        await expect(failure).rejects.not.toThrow('raw-body-secret');
        expect(mock.list).toHaveBeenCalledOnce();
    });

    it.each([
        [
            'message',
            401,
            (adapter: PayboxSdkAdapter) => adapter.signMessage(tokens, 'pbxk1.key', 'credential-a', 'hello'),
        ],
        [
            'message',
            403,
            (adapter: PayboxSdkAdapter) => adapter.signMessage(tokens, 'pbxk1.key', 'credential-a', 'hello'),
        ],
        [
            'transaction',
            401,
            (adapter: PayboxSdkAdapter) => adapter.signTransaction(tokens, 'pbxk1.key', 'credential-a', signingIntent),
        ],
        [
            'transaction',
            403,
            (adapter: PayboxSdkAdapter) => adapter.signTransaction(tokens, 'pbxk1.key', 'credential-a', signingIntent),
        ],
    ])('classifies authenticated %s-signing HTTP %i as confirmed invalid authority', async (_kind, status, request) => {
        const mock = factory([]);
        mock.sign.mockRejectedValueOnce(new PayboxError(status, 'key binding rejected', 'POST /agent/wallet-sign'));
        const adapter = new PayboxSdkAdapter(mock.factory);

        await expect(request(adapter)).rejects.toBeInstanceOf(PayboxAuthInvalidError);
        expect(mock.sign).toHaveBeenCalledOnce();
    });

    it('classifies an invalid OAuth refresh grant without weakening ambiguous refresh handling', async () => {
        const invalidGrant = new PayboxSdkAdapter(factory([]).factory, {
            refresh: vi.fn(async () => {
                throw new Error('token refresh failed (400): invalid_grant');
            }),
        });
        const unavailable = new PayboxSdkAdapter(factory([]).factory, {
            refresh: vi.fn(async () => {
                throw new Error('token refresh failed (503): unavailable');
            }),
        });

        const confirmed = invalidGrant.refreshTokens(tokens);
        const transient = unavailable.refreshTokens(tokens);

        await expect(confirmed).rejects.toBeInstanceOf(PayboxAuthInvalidError);
        await expect(confirmed).rejects.toMatchObject({
            diagnostic: {
                failureClass: 'confirmed_authentication',
                resetCause: 'invalid_refresh',
                resetDepth: 'full',
            },
        });
        await expect(transient).rejects.toBeInstanceOf(PayboxTemporarilyUnavailableError);
    });

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
        const mock = factory(response);
        const adapter = new PayboxSdkAdapter(mock.factory);

        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).rejects.toBeInstanceOf(
            PayboxOperationIncompleteError,
        );
        expect(mock.list).toHaveBeenCalledOnce();
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
        await expect(adapter.signMessage(tokens, 'pbxk1.key', 'credential-a', 'hello')).rejects.toBeInstanceOf(
            PayboxOperationIncompleteError,
        );
        mock.sign.mockResolvedValueOnce({
            status: 'success',
            output: { output_type: 'signature', credential_id: 'other', value: `0x${'a'.repeat(130)}` },
        });
        await expect(adapter.signMessage(tokens, 'pbxk1.key', 'credential-a', 'hello')).rejects.toBeInstanceOf(
            PayboxInvalidOperationArtifactError,
        );
    });

    it('sends the exact decimal-string EIP-1559 intent with the persisted credential ID', async () => {
        const mock = factory([]);
        const adapter = new PayboxSdkAdapter(mock.factory);
        const intent: PayboxTransactionIntent = {
            to: checksummedAddress,
            value: parseEther('0.5'),
            data: '0x1234',
            chainId: 4663,
            gas: 45_000n,
            maxPriorityFeePerGas: 2_000_000_000n,
            maxFeePerGas: 30_000_000_000n,
            nonce: 7,
        };
        mock.sign.mockResolvedValueOnce({
            status: 'success',
            output: { output_type: 'signature', credential_id: 'credential-a', value: '0x02ab' },
        });

        await expect(adapter.signTransaction(tokens, 'pbxk1.key', 'credential-a', intent)).resolves.toBe('0x02ab');
        expect(mock.sign).toHaveBeenCalledWith(
            {
                credentialId: 'credential-a',
                intent: {
                    op: 'transaction',
                    transaction: {
                        to: checksummedAddress,
                        value: '500000000000000000',
                        data: '0x1234',
                        chainId: 4663,
                        gas: '45000',
                        maxPriorityFeePerGas: '2000000000',
                        maxFeePerGas: '30000000000',
                        nonce: 7,
                    },
                },
            },
            { autoSign: true },
        );
    });

    it.each([
        [{ status: 'denied', output: null }, 'PAYBOX_OPERATION_DENIED'],
        [{ status: 'pending_signature', output: null }, 'PAYBOX_OPERATION_INCOMPLETE'],
        [
            { status: 'success', output: { output_type: 'signature', credential_id: 'other', value: '0x02ab' } },
            'PAYBOX_INVALID_OPERATION_ARTIFACT',
        ],
        [
            {
                status: 'success',
                output: { output_type: 'signature', credential_id: 'credential-a', value: 'not-hex' },
            },
            'PAYBOX_INVALID_OPERATION_ARTIFACT',
        ],
    ])('rejects unsupported transaction signing response %# before manager broadcast', async (response, message) => {
        const mock = factory([]);
        mock.sign.mockResolvedValueOnce(response);
        const adapter = new PayboxSdkAdapter(mock.factory);
        const intent: PayboxTransactionIntent = {
            to: checksummedAddress,
            value: 0n,
            data: '0x',
            chainId: 4663,
            gas: 21_000n,
            maxPriorityFeePerGas: 1n,
            maxFeePerGas: 2n,
            nonce: 0,
        };

        await expect(adapter.signTransaction(tokens, 'pbxk1.key', 'credential-a', intent)).rejects.toThrow(message);
    });
});
