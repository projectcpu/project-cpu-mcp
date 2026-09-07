import { PayboxError } from '@paybox-sh/sdk';
import { getAddress, parseEther } from 'viem';
import { describe, expect, it, vi } from 'vitest';

import type { ILogger } from '../../logger/types.js';
import type { SignTypedDataRequest } from '../../wallet/types.js';
import {
    PayboxAuthInvalidError,
    PayboxInvalidOperationArtifactError,
    PayboxOperationDeniedError,
    PayboxOperationIncompleteError,
    PayboxTemporarilyUnavailableError,
} from '../errors.js';
import { PayboxSdkAdapter } from '../sdk/adapter.js';
import { defaultPayboxTokenRefresher } from '../sdk/factory.js';
import type {
    PayboxSdkClient,
    PayboxSdkClientFactory,
    PayboxTokenRefresher,
    PayboxTokens,
    PayboxTransactionIntent,
} from '../types.js';

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
const typedData: SignTypedDataRequest = {
    domain: {
        name: 'Project CPU test',
        version: '1',
        chainId: 4663,
        verifyingContract: '0x0000000000000000000000000000000000000001',
    },
    types: { Test: [{ name: 'value', type: 'uint256' }] },
    primaryType: 'Test',
    message: { value: 1n },
};
const emptyCredentialList = { credentials: [], ungranted: [] };

function factory(result: unknown): {
    factory: PayboxSdkClientFactory;
    list: ReturnType<typeof vi.fn>;
    sign: ReturnType<typeof vi.fn>;
} {
    const list = vi.fn(async () => result);
    const sign = vi.fn(async () => ({
        status: 'success',
        output: {
            output_type: 'signature',
            credential_id: 'credential-a',
            value: { signature: `0x${'a'.repeat(130)}` },
        },
    }));
    return {
        factory: {
            create: vi.fn(() => ({ listCredentials: list, requestWalletSign: sign }) as unknown as PayboxSdkClient),
        },
        list,
        sign,
    };
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
    it('requests native EIP-712 signing from the selected Paybox credential', async () => {
        const mock = factory(emptyCredentialList);
        const adapter = new PayboxSdkAdapter(mock.factory);

        await expect(adapter.signTypedData(tokens, 'pbxk1.key', 'credential-a', typedData)).resolves.toMatch(
            /^0x[0-9a-f]+$/,
        );
        expect(mock.sign).toHaveBeenCalledWith(
            {
                credentialId: 'credential-a',
                intent: { op: 'typedData', typedData },
            },
            { autoSign: true },
        );
    });

    it('logs safe SDK diagnostics when authenticated credential discovery fails unexpectedly', async () => {
        const mock = factory(emptyCredentialList);
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

    it('classifies an untyped SDK signing failure without exposing or replaying it', async () => {
        const mock = factory(emptyCredentialList);
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
        [
            'typed-data pending result',
            { status: 'pending_signature', output: null },
            (adapter: PayboxSdkAdapter) => adapter.signTypedData(tokens, 'pbxk1.key', 'credential-a', typedData),
            PayboxOperationIncompleteError,
            'PAYBOX_OPERATION_INCOMPLETE',
            'operation_incomplete',
        ],
        [
            'typed-data malformed success artifact',
            { status: 'success', output: { output_type: 'signature', credential_id: 'other', value: 'not-hex' } },
            (adapter: PayboxSdkAdapter) => adapter.signTypedData(tokens, 'pbxk1.key', 'credential-a', typedData),
            PayboxInvalidOperationArtifactError,
            'PAYBOX_INVALID_OPERATION_ARTIFACT',
            'invalid_operation_artifact',
        ],
    ])(
        'classifies %s without invalidating or resubmitting',
        async (_case, response, request, ErrorClass, code, failureClass) => {
            const mock = factory(emptyCredentialList);
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
            'typed data',
            (adapter: PayboxSdkAdapter) => adapter.signTypedData(tokens, 'pbxk1.key', 'credential-a', typedData),
        ],
        [
            'transaction',
            (adapter: PayboxSdkAdapter) => adapter.signTransaction(tokens, 'pbxk1.key', 'credential-a', signingIntent),
        ],
    ])('classifies an ordinary denied %s exactly once without invalidating authority', async (_kind, request) => {
        const mock = factory(emptyCredentialList);
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
        const mock = factory(emptyCredentialList);
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
        const mock = factory(emptyCredentialList);
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
            'typed data',
            401,
            (adapter: PayboxSdkAdapter) => adapter.signTypedData(tokens, 'pbxk1.key', 'credential-a', typedData),
        ],
        [
            'typed data',
            403,
            (adapter: PayboxSdkAdapter) => adapter.signTypedData(tokens, 'pbxk1.key', 'credential-a', typedData),
        ],
        [
            'transaction',
            403,
            (adapter: PayboxSdkAdapter) => adapter.signTransaction(tokens, 'pbxk1.key', 'credential-a', signingIntent),
        ],
    ])('classifies authenticated %s-signing HTTP %i as confirmed invalid authority', async (_kind, status, request) => {
        const mock = factory(emptyCredentialList);
        mock.sign.mockRejectedValueOnce(new PayboxError(status, 'key binding rejected', 'POST /agent/wallet-sign'));
        const adapter = new PayboxSdkAdapter(mock.factory);

        await expect(request(adapter)).rejects.toBeInstanceOf(PayboxAuthInvalidError);
        expect(mock.sign).toHaveBeenCalledOnce();
    });

    it('classifies an invalid OAuth refresh grant without weakening ambiguous refresh handling', async () => {
        const invalidGrant = new PayboxSdkAdapter(factory(emptyCredentialList).factory, {
            refresh: vi.fn(async () => {
                throw new Error('token refresh failed (400): invalid_grant');
            }),
        });
        const unavailable = new PayboxSdkAdapter(factory(emptyCredentialList).factory, {
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
        const adapter = new PayboxSdkAdapter(factory(emptyCredentialList).factory, refresher);

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
            const adapter = new PayboxSdkAdapter(factory(emptyCredentialList).factory, refresher);

            await expect(adapter.refreshTokens(tokens)).rejects.toThrow();
        },
    );

    it('normalizes the live envelope carrying sibling keys and a chains array', async () => {
        const mock = factory({
            credentials: [
                {
                    credential: {
                        id: 'evm-default',
                        name: 'evm-default',
                        provider: 'sodot',
                        credential_type: 'wallet',
                        disabled_at: null,
                        metadata: { chains: ['evm'], address },
                    },
                    grant: { credential_id: 'evm-default', approval_mode: 'autonomous' },
                },
                {
                    credential: {
                        id: 'sol-default',
                        name: 'sol-default',
                        provider: 'sodot',
                        credential_type: 'wallet',
                        disabled_at: null,
                        metadata: { chains: ['solana'], address: 'GU44hZq3nQEXnEAVmVvEY8MUCseDgENaArJBnH2N26Rz' },
                    },
                    grant: { credential_id: 'sol-default', approval_mode: 'autonomous' },
                },
            ],
            ungranted: [],
        });
        const adapter = new PayboxSdkAdapter(mock.factory);

        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).resolves.toEqual({
            grants: [
                {
                    credentialId: 'evm-default',
                    address: checksummedAddress,
                    label: 'evm-default',
                    provider: 'sodot',
                },
            ],
            managementUrl: 'https://app.paybox.test',
        });
    });

    it('reads the SDK credential-list response', async () => {
        const row = {
            credential: {
                id: 'credential-a',
                name: 'Primary wallet',
                provider: 'embedded',
                credential_type: 'wallet',
                disabled_at: null,
                metadata: { chain: 'evm', address },
            },
            grant: { credential_id: 'credential-a', approval_mode: 'autonomous' },
        };
        const mock = factory({ credentials: [row], ungranted: [] });
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
    });

    it('isolates an invalid Wallet address without substituting another identity', async () => {
        const row = (id: string, walletAddress: string): Record<string, unknown> => ({
            credential: {
                id,
                name: id,
                provider: 'test',
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
                    label: 'valid-address',
                    provider: 'test',
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

    it.each([
        { credentials: [], ungranted: [], grants: [] },
        { credentials: [], ungranted: [], shadow: [] },
    ])('reads the credentials list past unknown sibling keys: %j', async (response) => {
        const mock = factory(response);
        const adapter = new PayboxSdkAdapter(mock.factory);

        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).resolves.toEqual({
            grants: [],
            managementUrl: 'https://app.paybox.test',
        });
    });

    it('constructs an explicit client and returns the sole enabled autonomous EVM wallet', async () => {
        const mock = factory({
            credentials: [
                {
                    credential: {
                        id: 'credential-a',
                        name: 'Credential A',
                        provider: 'test',
                        credential_type: 'wallet',
                        disabled_at: null,
                        metadata: { chain: 'evm', address },
                    },
                    grant: { credential_id: 'credential-a', approval_mode: 'autonomous' },
                },
            ],
            ungranted: [],
        });
        const adapter = new PayboxSdkAdapter(mock.factory);

        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).resolves.toEqual({
            grants: [
                {
                    credentialId: 'credential-a',
                    address: checksummedAddress,
                    label: 'Credential A',
                    provider: 'test',
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
        const mock = factory(emptyCredentialList);
        const adapter = new PayboxSdkAdapter(mock.factory);
        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).resolves.toEqual({
            grants: [],
            managementUrl: 'https://app.paybox.test',
        });

        mock.list.mockResolvedValueOnce({
            credentials: [
                {
                    credential: {
                        id: 'a',
                        name: 'A',
                        provider: 'test',
                        credential_type: 'wallet',
                        disabled_at: null,
                        metadata: { chain: 'evm', address },
                    },
                    grant: { credential_id: 'a', approval_mode: 'autonomous' },
                },
                {
                    credential: {
                        id: 'b',
                        name: 'B',
                        provider: 'test',
                        credential_type: 'wallet',
                        disabled_at: null,
                        metadata: { chain: 'eip155:4663', address },
                    },
                    grant: { credential_id: 'b', approval_mode: 'autonomous' },
                },
            ],
            ungranted: [],
        });
        await expect(adapter.listEligibleAutonomousEvmGrants(tokens, 'pbxk1.key')).resolves.toEqual({
            grants: [
                { credentialId: 'a', address: checksummedAddress, label: 'A', provider: 'test' },
                { credentialId: 'b', address: checksummedAddress, label: 'B', provider: 'test' },
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
        const adapter = new PayboxSdkAdapter(factory(emptyCredentialList).factory);

        await expect(adapter.listEligibleAutonomousEvmGrants({ ...tokens, baseUrl }, 'pbxk1.key')).resolves.toEqual({
            grants: [],
            managementUrl,
        });
    });

    it('passes the opaque credential ID explicitly and rejects non-success signature responses', async () => {
        const mock = factory(emptyCredentialList);
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

    it('reads the live artifact envelope the in-process signer returns', async () => {
        const signature = `0x${'a'.repeat(130)}`;
        const mock = factory(emptyCredentialList);
        const adapter = new PayboxSdkAdapter(mock.factory);

        mock.sign.mockResolvedValueOnce({
            status: 'success',
            output: { output_type: 'signature', credential_id: 'credential-a', value: { signature } },
        });
        await expect(adapter.signMessage(tokens, 'pbxk1.key', 'credential-a', 'hello')).resolves.toBe(signature);

        mock.sign.mockResolvedValueOnce({
            status: 'success',
            output: {
                output_type: 'signature',
                credential_id: 'credential-a',
                value: { serializedTransaction: '0x02ab' },
            },
        });
        await expect(adapter.signTransaction(tokens, 'pbxk1.key', 'credential-a', signingIntent)).resolves.toBe(
            '0x02ab',
        );
    });

    it('sends the exact decimal-string EIP-1559 intent with the persisted credential ID', async () => {
        const mock = factory(emptyCredentialList);
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
            output: {
                output_type: 'signature',
                credential_id: 'credential-a',
                value: { serializedTransaction: '0x02ab' },
            },
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
            {
                status: 'success',
                output: {
                    output_type: 'signature',
                    credential_id: 'other',
                    value: { serializedTransaction: '0x02ab' },
                },
            },
            'PAYBOX_INVALID_OPERATION_ARTIFACT',
        ],
    ])('rejects unsupported transaction signing response %# before manager broadcast', async (response, message) => {
        const mock = factory(emptyCredentialList);
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
