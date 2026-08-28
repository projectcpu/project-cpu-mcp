import { describe, expect, it, vi } from 'vitest';

import { AuthenticationRequiredError } from '../../api/authentication-required.error.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type { ILogger } from '../../logger/types.js';
import type { WalletManager } from '../../wallet/types.js';
import { PayboxCoordinator } from '../auth/coordinator.js';
import {
    PayboxAuthInvalidError,
    PayboxAuthFlowError,
    PayboxLoopbackUnavailableError,
    PayboxTemporarilyUnavailableError,
} from '../errors.js';
import {
    PayboxAuthStatus,
    PayboxRefreshFailureDisposition,
    PayboxResetCause,
    type IPayboxAuthStorage,
    type IPayboxRpcClient,
    type IPayboxSdkAdapter,
    type PayboxAuthFlow,
    type PayboxAuthRecord,
    type PayboxSiweAuthenticator,
    type PayboxWalletAuthority,
} from '../types.js';
import { PayboxWalletManager } from '../wallet/manager.js';

const wallet = { getAddress: () => '0x0000000000000000000000000000000000000001' } as unknown as WalletManager;

function recordingLogger(): { logger: ILogger; warn: ReturnType<typeof vi.fn> } {
    const warn = vi.fn();
    return {
        logger: {
            info: vi.fn(),
            warn,
            error: vi.fn(),
            debug: vi.fn(),
            child: vi.fn(),
        } as unknown as ILogger,
        warn,
    };
}

describe('PayboxCoordinator', () => {
    it('logs only classified recovery metadata for an authentication-flow failure', async () => {
        const diagnostics = recordingLogger();
        const coordinator = new PayboxCoordinator(
            {
                storage: { load: () => null, save: vi.fn(), clear: vi.fn() },
                flow: {
                    start: vi.fn(async () => Promise.reject(new PayboxAuthFlowError())),
                    finish: vi.fn(),
                },
                sdk: {} as IPayboxSdkAdapter,
                authenticator: testAuthenticator(vi.fn()),
            },
            diagnostics.logger,
        );

        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).rejects.toBeInstanceOf(
            PayboxAuthFlowError,
        );
        expect(diagnostics.warn).toHaveBeenCalledOnce();
        expect(diagnostics.warn).toHaveBeenCalledWith('Paybox authentication request failed', {
            failureClass: 'authentication_flow',
            resetCause: null,
            resetDepth: 'none',
        });
    });

    it('clears the game session before forced authentication returns a new OAuth state', async () => {
        const events = new Array<string>();
        const coordinator = new PayboxCoordinator({
            storage: {
                load: () => ({
                    version: 1,
                    tokens: {
                        clientId: 'client',
                        accessToken: 'access',
                        refreshToken: null,
                        expiresAt: null,
                        resource: null,
                        baseUrl: 'https://paybox.test',
                    },
                    signingKey: 'pbxk1.test',
                    credentialId: 'credential',
                    address: '0x0000000000000000000000000000000000000001',
                }),
                save: vi.fn(),
                clear: vi.fn(() => events.push('paybox-cleared')),
            },
            flow: {
                start: vi.fn(async () => {
                    events.push('oauth-started');
                    return { authorizationUrl: 'https://accounts.test/authorize?state=fresh' };
                }),
                finish: vi.fn(),
            },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: vi.fn(async () => selectedGrantList('credential')),
                createWallet: vi.fn(() => wallet),
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: {
                authenticate: vi.fn(),
                clearSession: vi.fn(() => events.push('session-cleared')),
            },
        });

        await expect(coordinator.authenticate({ force: true, payboxCredentialId: null })).resolves.toEqual(
            expect.objectContaining({
                status: PayboxAuthStatus.AuthRequired,
                authorizationUrl: 'https://accounts.test/authorize?state=fresh',
            }),
        );

        expect(events).toEqual(['paybox-cleared', 'session-cleared', 'oauth-started']);
        expect(coordinator.isReady()).toBe(false);
        expect(() => coordinator.get()).toThrow('not authenticated');
    });

    it('single-flights forced authentication with differing stale Wallet selections', async () => {
        const startResult = controlledPromise<{ authorizationUrl: string }>();
        const events = new Array<string>();
        const clear = vi.fn(() => events.push('paybox-cleared'));
        const clearSession = vi.fn(() => events.push('session-cleared'));
        const start = vi.fn(() => {
            events.push('oauth-started');
            return startResult.promise;
        });
        const coordinator = new PayboxCoordinator({
            storage: { load: () => null, save: vi.fn(), clear },
            flow: { start, finish: vi.fn() },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: vi.fn(),
                createWallet: vi.fn(),
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: { authenticate: vi.fn(), clearSession },
        });

        const first = coordinator.authenticate({ force: true, payboxCredentialId: 'stale-credential-a' });
        const second = coordinator.authenticate({ force: true, payboxCredentialId: 'stale-credential-b' });
        await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
        expect(clear).toHaveBeenCalledOnce();
        expect(clearSession).toHaveBeenCalledOnce();
        expect(events).toEqual(['paybox-cleared', 'session-cleared', 'oauth-started']);

        startResult.resolve({ authorizationUrl: 'https://accounts.test/authorize?state=shared' });
        await expect(Promise.all([first, second])).resolves.toEqual([
            expect.objectContaining({
                status: PayboxAuthStatus.AuthRequired,
                authorizationUrl: 'https://accounts.test/authorize?state=shared',
            }),
            expect.objectContaining({
                status: PayboxAuthStatus.AuthRequired,
                authorizationUrl: 'https://accounts.test/authorize?state=shared',
            }),
        ]);
        expect(start).toHaveBeenCalledOnce();
    });

    it('fully resets a restored selection that disappears without choosing its replacement', async () => {
        const clear = vi.fn();
        const clearSession = vi.fn();
        const authenticate = vi.fn(async () => 'game-jwt');
        const start = vi.fn(async () => ({ authorizationUrl: 'https://accounts.test/authorize?state=fresh' }));
        const diagnostics = recordingLogger();
        const coordinator = new PayboxCoordinator(
            {
                storage: {
                    load: () => ({
                        version: 1,
                        tokens: {
                            clientId: 'client',
                            accessToken: 'access',
                            refreshToken: null,
                            expiresAt: null,
                            resource: null,
                            baseUrl: 'https://paybox.test',
                        },
                        signingKey: 'pbxk1.test',
                        credentialId: 'missing-credential',
                        address: '0x0000000000000000000000000000000000000001',
                    }),
                    save: vi.fn(),
                    clear,
                },
                flow: { start, finish: vi.fn() },
                sdk: {
                    refreshTokens: vi.fn(),
                    listEligibleAutonomousEvmGrants: vi.fn(async () => ({
                        grants: [
                            {
                                credentialId: 'replacement',
                                address: '0x0000000000000000000000000000000000000002',
                                label: null,
                                provider: null,
                            },
                        ],
                        managementUrl: null,
                    })),
                    createWallet: vi.fn(() => wallet),
                    signMessage: vi.fn(),
                    signTransaction: vi.fn(),
                },
                authenticator: { authenticate, clearSession },
            },
            diagnostics.logger,
        );

        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual(
            expect.objectContaining({
                status: PayboxAuthStatus.AuthRequired,
                authorizationUrl: 'https://accounts.test/authorize?state=fresh',
            }),
        );

        expect(clear).toHaveBeenCalledOnce();
        expect(clearSession).toHaveBeenCalledOnce();
        expect(start).toHaveBeenCalledOnce();
        expect(authenticate).not.toHaveBeenCalled();
        expect(coordinator.isReady()).toBe(false);
        expect(diagnostics.warn).toHaveBeenCalledWith('Paybox authentication authority invalidated', {
            failureClass: 'confirmed_authentication',
            resetCause: 'selected_grant_missing',
            resetDepth: 'full',
        });
    });

    it('single-flights restored grant validation and fresh SIWE', async () => {
        const discovery = controlledPromise<{
            grants: Array<{
                credentialId: string;
                address: string;
                label: string | null;
                provider: string | null;
            }>;
            managementUrl: string | null;
        }>();
        const authentication = controlledPromise<string>();
        const listGrants = vi.fn(() => discovery.promise);
        const authenticate = vi.fn(() => authentication.promise);
        const coordinator = new PayboxCoordinator({
            storage: {
                load: () => ({
                    version: 1,
                    tokens: {
                        clientId: 'client',
                        accessToken: 'access',
                        refreshToken: null,
                        expiresAt: null,
                        resource: null,
                        baseUrl: 'https://paybox.test',
                    },
                    signingKey: 'pbxk1.test',
                    credentialId: 'credential',
                    address: '0x0000000000000000000000000000000000000001',
                }),
                save: vi.fn(),
                clear: vi.fn(),
            },
            flow: { start: vi.fn(), finish: vi.fn() },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: listGrants,
                createWallet: vi.fn(() => wallet),
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: { authenticate, clearSession: vi.fn() },
        });

        const first = coordinator.authenticate({ force: false, payboxCredentialId: null });
        const second = coordinator.authenticate({ force: false, payboxCredentialId: null });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(listGrants).toHaveBeenCalledOnce();

        discovery.resolve({
            grants: [
                {
                    credentialId: 'credential',
                    address: '0x0000000000000000000000000000000000000001',
                    label: null,
                    provider: null,
                },
            ],
            managementUrl: null,
        });
        await vi.waitFor(() => expect(authenticate).toHaveBeenCalledOnce());
        authentication.resolve('game-jwt');

        await expect(Promise.all([first, second])).resolves.toEqual([
            { status: PayboxAuthStatus.Authenticated, address: '0x0000000000000000000000000000000000000001' },
            { status: PayboxAuthStatus.Authenticated, address: '0x0000000000000000000000000000000000000001' },
        ]);
        expect(listGrants).toHaveBeenCalledOnce();
        expect(authenticate).toHaveBeenCalledOnce();
    });

    it('uses the full reset transition for a confirmed auth failure and restarts OAuth', async () => {
        const clear = vi.fn();
        const clearSession = vi.fn();
        const start = vi.fn(async () => ({ authorizationUrl: 'https://accounts.test/authorize?state=recovery' }));
        const diagnostics = recordingLogger();
        const coordinator = new PayboxCoordinator(
            {
                storage: {
                    load: () => ({
                        version: 1,
                        tokens: {
                            clientId: 'client',
                            accessToken: 'revoked-access',
                            refreshToken: null,
                            expiresAt: null,
                            resource: null,
                            baseUrl: 'https://paybox.test',
                        },
                        signingKey: 'pbxk1.test',
                        credentialId: 'credential',
                        address: '0x0000000000000000000000000000000000000001',
                    }),
                    save: vi.fn(),
                    clear,
                },
                flow: { start, finish: vi.fn() },
                sdk: {
                    refreshTokens: vi.fn(),
                    listEligibleAutonomousEvmGrants: vi.fn(async () => {
                        throw new PayboxAuthInvalidError(
                            'Paybox OAuth authority was rejected.',
                            PayboxResetCause.AuthenticatedRequestRejected,
                        );
                    }),
                    createWallet: vi.fn(() => wallet),
                    signMessage: vi.fn(),
                    signTransaction: vi.fn(),
                },
                authenticator: { authenticate: vi.fn(), clearSession },
            },
            diagnostics.logger,
        );

        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual(
            expect.objectContaining({
                status: PayboxAuthStatus.AuthRequired,
                authorizationUrl: 'https://accounts.test/authorize?state=recovery',
            }),
        );

        expect(clear).toHaveBeenCalledOnce();
        expect(clearSession).toHaveBeenCalledOnce();
        expect(start).toHaveBeenCalledOnce();
        expect(coordinator.isReady()).toBe(false);
        expect(diagnostics.warn).toHaveBeenCalledWith('Paybox authentication authority invalidated', {
            failureClass: 'confirmed_authentication',
            resetCause: 'authenticated_request_rejected',
            resetDepth: 'full',
        });
    });

    it('keeps the restored manager ready without constructing a replacement during token rotation', async () => {
        const storedTokens = {
            clientId: 'client',
            accessToken: 'old-access',
            refreshToken: 'old-refresh',
            expiresAt: Date.now() - 1,
            resource: null,
            baseUrl: 'https://paybox.test',
        };
        const oldWallet = {
            getAddress: () => '0x0000000000000000000000000000000000000001',
        } as unknown as WalletManager;
        const createWallet = vi
            .fn<IPayboxSdkAdapter['createWallet']>()
            .mockReturnValueOnce(oldWallet)
            .mockImplementationOnce(() => {
                throw new Error('replacement construction failed');
            });
        const coordinator = new PayboxCoordinator({
            storage: {
                load: () => ({
                    version: 1,
                    tokens: storedTokens,
                    signingKey: 'pbxk1.test',
                    credentialId: 'credential',
                    address: '0x0000000000000000000000000000000000000001',
                }),
                save: vi.fn(),
                clear: vi.fn(),
            },
            flow: { start: vi.fn(), finish: vi.fn() },
            sdk: {
                refreshTokens: vi.fn(async () => ({
                    ...storedTokens,
                    accessToken: 'new-access',
                    refreshToken: 'new-refresh',
                    expiresAt: Date.now() + 600_000,
                })),
                listEligibleAutonomousEvmGrants: vi.fn(async () => selectedGrantList('credential')),
                createWallet,
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(vi.fn(async () => 'game-jwt')),
        });

        expect(coordinator.get()).toBe(oldWallet);
        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual({
            status: PayboxAuthStatus.Authenticated,
            address: '0x0000000000000000000000000000000000000001',
        });

        expect(createWallet).toHaveBeenCalledOnce();
        expect(coordinator.isReady()).toBe(true);
        expect(coordinator.get()).toBe(oldWallet);
    });

    it('fully resets expired authority that has no refresh token and restarts OAuth', async () => {
        const clear = vi.fn();
        const clearSession = vi.fn();
        const start = vi.fn(async () => ({ authorizationUrl: 'https://accounts.test/authorize?state=refresh' }));
        const coordinator = new PayboxCoordinator({
            storage: {
                load: () => ({
                    version: 1,
                    tokens: {
                        clientId: 'client',
                        accessToken: 'expired-access',
                        refreshToken: null,
                        expiresAt: Date.now() - 1,
                        resource: null,
                        baseUrl: 'https://paybox.test',
                    },
                    signingKey: 'pbxk1.test',
                    credentialId: 'credential',
                    address: '0x0000000000000000000000000000000000000001',
                }),
                save: vi.fn(),
                clear,
            },
            flow: { start, finish: vi.fn() },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: vi.fn(async () => selectedGrantList('credential')),
                createWallet: vi.fn(() => wallet),
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: { authenticate: vi.fn(), clearSession },
        });

        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual(
            expect.objectContaining({
                status: PayboxAuthStatus.AuthRequired,
                authorizationUrl: 'https://accounts.test/authorize?state=refresh',
            }),
        );
        expect(clear).toHaveBeenCalledOnce();
        expect(clearSession).toHaveBeenCalledOnce();
        expect(start).toHaveBeenCalledOnce();
        expect(coordinator.isReady()).toBe(false);
    });

    it('restores a selected Wallet synchronously without repeating OAuth', async () => {
        const tokens = {
            clientId: 'client',
            accessToken: 'stored-access',
            refreshToken: 'stored-refresh',
            expiresAt: Date.now() + 600_000,
            resource: 'https://api.paybox.test/mcp',
            baseUrl: 'https://api.paybox.test',
        };
        const start = vi.fn();
        const createWallet = vi.fn(() => wallet);
        const authenticate = vi.fn(async () => 'game-jwt');
        const coordinator = new PayboxCoordinator({
            storage: {
                load: vi.fn(() => ({
                    version: 1 as const,
                    tokens,
                    signingKey: 'pbxk1.test',
                    credentialId: 'stored-credential',
                    address: '0x0000000000000000000000000000000000000001' as const,
                })),
                save: vi.fn(),
                clear: vi.fn(),
            },
            flow: { start, finish: vi.fn() },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: vi.fn(async () => selectedGrantList('stored-credential')),
                createWallet,
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(authenticate),
        });

        expect(coordinator.isReady()).toBe(true);
        expect(coordinator.get()).toBe(wallet);
        expect(createWallet).toHaveBeenCalledOnce();
        expect(createWallet).toHaveBeenCalledWith(
            tokens,
            'pbxk1.test',
            'stored-credential',
            '0x0000000000000000000000000000000000000001',
            expect.anything(),
        );

        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual({
            status: PayboxAuthStatus.Authenticated,
            address: '0x0000000000000000000000000000000000000001',
        });
        expect(authenticate).toHaveBeenCalledOnce();
        expect(start).not.toHaveBeenCalled();
    });

    it('single-flights refresh and persists rotation without replacing the restored Wallet queue', async () => {
        const storedTokens = {
            clientId: 'client',
            accessToken: 'old-access',
            refreshToken: 'old-refresh',
            expiresAt: Date.now() - 1,
            resource: 'https://api.paybox.test/mcp',
            baseUrl: 'https://api.paybox.test',
        };
        const rotatedTokens = {
            ...storedTokens,
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            expiresAt: Date.now() + 600_000,
        };
        const refresh = controlledPromise<typeof rotatedTokens>();
        const refreshTokens = vi.fn(() => refresh.promise);
        const oldWallet = {
            getAddress: () => '0x0000000000000000000000000000000000000001',
        } as unknown as WalletManager;
        const createWallet = vi.fn(() => oldWallet);
        const save = vi.fn();
        const authenticate = vi.fn(async () => 'game-jwt');
        const start = vi.fn();
        const coordinator = new PayboxCoordinator({
            storage: {
                load: () => ({
                    version: 1,
                    tokens: storedTokens,
                    signingKey: 'pbxk1.test',
                    credentialId: 'stored-credential',
                    address: '0x0000000000000000000000000000000000000001',
                }),
                save,
                clear: vi.fn(),
            },
            flow: { start, finish: vi.fn() },
            sdk: {
                refreshTokens,
                listEligibleAutonomousEvmGrants: vi.fn(async () => selectedGrantList('stored-credential')),
                createWallet,
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(authenticate),
        });

        expect(coordinator.get()).toBe(oldWallet);
        const first = coordinator.authenticate({ force: false, payboxCredentialId: null });
        const second = coordinator.authenticate({ force: false, payboxCredentialId: null });
        await vi.waitFor(() => expect(refreshTokens).toHaveBeenCalledOnce());
        expect(authenticate).not.toHaveBeenCalled();

        refresh.resolve(rotatedTokens);
        await expect(Promise.all([first, second])).resolves.toEqual([
            { status: PayboxAuthStatus.Authenticated, address: '0x0000000000000000000000000000000000000001' },
            { status: PayboxAuthStatus.Authenticated, address: '0x0000000000000000000000000000000000000001' },
        ]);

        expect(save).toHaveBeenCalledTimes(2);
        expect(save).toHaveBeenNthCalledWith(1, {
            version: 1,
            tokens: storedTokens,
            signingKey: 'pbxk1.test',
            credentialId: 'stored-credential',
            address: '0x0000000000000000000000000000000000000001',
            refreshState: 'exchange_pending',
        });
        expect(save).toHaveBeenNthCalledWith(2, {
            version: 1,
            tokens: rotatedTokens,
            signingKey: 'pbxk1.test',
            credentialId: 'stored-credential',
            address: '0x0000000000000000000000000000000000000001',
        });
        expect(createWallet).toHaveBeenCalledOnce();
        expect(coordinator.get()).toBe(oldWallet);
        expect(authenticate).toHaveBeenCalledOnce();
        expect(authenticate).toHaveBeenCalledWith(oldWallet, expect.any(AbortSignal));
        expect(start).not.toHaveBeenCalled();
    });

    it('keeps a retained Wallet current after token rotation', async () => {
        const storedTokens = {
            clientId: 'client',
            accessToken: 'old-access',
            refreshToken: 'old-refresh',
            expiresAt: Date.now() - 1,
            resource: 'https://api.paybox.test/mcp',
            baseUrl: 'https://api.paybox.test',
        };
        const rotatedTokens = {
            ...storedTokens,
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            expiresAt: Date.now() + 600_000,
        };
        const createWallet = vi.fn(
            (
                _tokens: Parameters<IPayboxSdkAdapter['createWallet']>[0],
                _signingKey: string,
                _credentialId: string,
                address: string,
                authority: PayboxWalletAuthority,
            ) =>
                ({
                    getAddress: () => address,
                    signMessage: async () => (await authority.current()).tokens.accessToken,
                }) as unknown as WalletManager,
        );
        const coordinator = new PayboxCoordinator({
            storage: {
                load: () => ({
                    version: 1,
                    tokens: storedTokens,
                    signingKey: 'pbxk1.test',
                    credentialId: 'stored-credential',
                    address: '0x0000000000000000000000000000000000000001',
                }),
                save: vi.fn(),
                clear: vi.fn(),
            },
            flow: { start: vi.fn(), finish: vi.fn() },
            sdk: {
                refreshTokens: vi.fn(async () => rotatedTokens),
                listEligibleAutonomousEvmGrants: vi.fn(async () => selectedGrantList('stored-credential')),
                createWallet,
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(vi.fn(async () => 'game-jwt')),
        });
        const retainedWallet = coordinator.get();

        await coordinator.authenticate({ force: false, payboxCredentialId: null });

        expect(coordinator.get()).toBe(retainedWallet);
        await expect(retainedWallet.signMessage('current intent')).resolves.toBe('new-access');
        expect(createWallet).toHaveBeenCalledOnce();
    });

    it('preserves one serialized Wallet queue across refresh for sequential overlapping sends', async () => {
        const storedTokens = {
            clientId: 'client',
            accessToken: 'old-access',
            refreshToken: 'old-refresh',
            expiresAt: Date.now() - 1,
            resource: 'https://api.paybox.test/mcp',
            baseUrl: 'https://api.paybox.test',
        };
        const rotatedTokens = {
            ...storedTokens,
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            expiresAt: Date.now() + 600_000,
        };
        const refresh = controlledPromise<typeof rotatedTokens>();
        const nonces = [7, 8];
        const signed = new Array<{ accessToken: string; nonce: number }>();
        const createWallet = vi.fn(
            (
                _tokens: Parameters<IPayboxSdkAdapter['createWallet']>[0],
                _signingKey: string,
                _credentialId: string,
                address: string,
                authority: PayboxWalletAuthority,
            ) => {
                let queue = Promise.resolve();
                return {
                    getAddress: () => address,
                    sendTransaction: () => {
                        const operation = queue.then(async () => {
                            const current = await authority.current();
                            const nonce = nonces.shift() as number;
                            signed.push({ accessToken: current.tokens.accessToken, nonce });
                            return `0x${nonce}`;
                        });
                        queue = operation.then(() => undefined);
                        return operation;
                    },
                } as unknown as WalletManager;
            },
        );
        const coordinator = new PayboxCoordinator({
            storage: {
                load: () => ({
                    version: 1,
                    tokens: storedTokens,
                    signingKey: 'pbxk1.test',
                    credentialId: 'stored-credential',
                    address: '0x0000000000000000000000000000000000000001',
                }),
                save: vi.fn(),
                clear: vi.fn(),
            },
            flow: { start: vi.fn(), finish: vi.fn() },
            sdk: {
                refreshTokens: vi.fn(() => refresh.promise),
                listEligibleAutonomousEvmGrants: vi.fn(),
                createWallet,
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(vi.fn()),
        });
        const retainedWallet = coordinator.get();

        const first = retainedWallet.sendTransaction({
            to: '0x0000000000000000000000000000000000000002',
            data: '0x01',
            value: null,
            gas: null,
        });
        const second = retainedWallet.sendTransaction({
            to: '0x0000000000000000000000000000000000000002',
            data: '0x02',
            value: null,
            gas: null,
        });
        refresh.resolve(rotatedTokens);

        await expect(Promise.all([first, second])).resolves.toEqual(['0x7', '0x8']);
        expect(signed).toEqual([
            { accessToken: 'new-access', nonce: 7 },
            { accessToken: 'new-access', nonce: 8 },
        ]);
        expect(createWallet).toHaveBeenCalledOnce();
        expect(coordinator.get()).toBe(retainedWallet);
    });

    it('does not reuse a consumed refresh token after rotated-token persistence fails', async () => {
        const storedTokens = {
            clientId: 'client',
            accessToken: 'old-access',
            refreshToken: 'single-use-refresh',
            expiresAt: Date.now() - 1,
            resource: 'https://api.paybox.test/mcp',
            baseUrl: 'https://api.paybox.test',
        };
        const rotatedTokens = {
            ...storedTokens,
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            expiresAt: Date.now() + 600_000,
        };
        const refreshTokens = vi.fn(async () => rotatedTokens);
        let saveCount = 0;
        const save = vi.fn(() => {
            saveCount += 1;
            if (saveCount === 2) throw new Error('disk full');
        });
        const authenticate = vi.fn(async () => 'game-jwt');
        const coordinator = new PayboxCoordinator({
            storage: {
                load: () => ({
                    version: 1,
                    tokens: storedTokens,
                    signingKey: 'pbxk1.test',
                    credentialId: 'stored-credential',
                    address: '0x0000000000000000000000000000000000000001',
                }),
                save,
                clear: vi.fn(),
            },
            flow: { start: vi.fn(), finish: vi.fn() },
            sdk: {
                refreshTokens,
                listEligibleAutonomousEvmGrants: vi.fn(),
                createWallet: vi.fn(() => wallet),
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(authenticate),
        });

        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).rejects.toThrow('disk full');
        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).rejects.toThrow('disk full');

        expect(refreshTokens).toHaveBeenCalledOnce();
        expect(refreshTokens).toHaveBeenCalledWith(storedTokens);
        expect(save).toHaveBeenCalledTimes(2);
        expect(authenticate).not.toHaveBeenCalled();
    });

    it('retries an ambiguous refresh failure on the next explicit authentication', async () => {
        const storedTokens = {
            clientId: 'client',
            accessToken: 'old-access',
            refreshToken: 'single-use-refresh',
            expiresAt: Date.now() - 1,
            resource: 'https://api.paybox.test/mcp',
            baseUrl: 'https://api.paybox.test',
        };
        const rotatedTokens = {
            ...storedTokens,
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            expiresAt: Date.now() + 600_000,
        };
        const refreshError = new PayboxTemporarilyUnavailableError(
            { cause: new TypeError('fetch failed') },
            PayboxRefreshFailureDisposition.Ambiguous,
        );
        const refreshTokens = vi.fn(async () => rotatedTokens);
        refreshTokens.mockRejectedValueOnce(refreshError);
        const save = vi.fn();
        const coordinator = new PayboxCoordinator({
            storage: {
                load: () => ({
                    version: 1,
                    tokens: storedTokens,
                    signingKey: 'pbxk1.test',
                    credentialId: 'stored-credential',
                    address: '0x0000000000000000000000000000000000000001',
                }),
                save,
                clear: vi.fn(),
            },
            flow: { start: vi.fn(), finish: vi.fn() },
            sdk: {
                refreshTokens,
                listEligibleAutonomousEvmGrants: vi.fn(async () => selectedGrantList('stored-credential')),
                createWallet: vi.fn(() => wallet),
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(vi.fn(async () => 'game-jwt')),
        });

        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).rejects.toBe(refreshError);
        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual({
            status: PayboxAuthStatus.Authenticated,
            address: '0x0000000000000000000000000000000000000001',
        });

        expect(refreshTokens).toHaveBeenCalledTimes(2);
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ refreshState: 'exchange_pending' }));
        expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ tokens: rotatedTokens }));
    });

    it.each([
        ['HTTP 429', new PayboxTemporarilyUnavailableError(null, PayboxRefreshFailureDisposition.SafeToRetry), 'ready'],
        ['HTTP 503', new PayboxTemporarilyUnavailableError(null, PayboxRefreshFailureDisposition.SafeToRetry), 'ready'],
        [
            'network failure',
            new PayboxTemporarilyUnavailableError(
                { cause: new TypeError('fetch failed') },
                PayboxRefreshFailureDisposition.Ambiguous,
            ),
            'ready',
        ],
        [
            'timeout',
            new PayboxTemporarilyUnavailableError(
                {
                    cause: new DOMException('request timed out', 'TimeoutError'),
                },
                PayboxRefreshFailureDisposition.Ambiguous,
            ),
            'ready',
        ],
    ])('preserves durable and runtime authority when refresh hits %s', async (_case, refreshError, refreshState) => {
        const storedTokens = {
            clientId: 'client',
            accessToken: 'old-access',
            refreshToken: 'single-use-refresh',
            expiresAt: Date.now() - 1,
            resource: 'https://api.paybox.test/mcp',
            baseUrl: 'https://api.paybox.test',
        };
        const storedRecord: PayboxAuthRecord = {
            version: 1,
            tokens: storedTokens,
            signingKey: 'pbxk1.test',
            credentialId: 'stored-credential',
            address: '0x0000000000000000000000000000000000000001',
        };
        let persistedRecord: PayboxAuthRecord | null = storedRecord;
        const save = vi.fn<IPayboxAuthStorage['save']>((record) => {
            persistedRecord = record;
        });
        const clear = vi.fn(() => {
            persistedRecord = null;
        });
        const clearSession = vi.fn();
        const refreshTokens = vi.fn(async () => Promise.reject(refreshError));
        const createWallet = vi.fn(() => wallet);
        const options = {
            storage: { load: vi.fn(() => persistedRecord), save, clear },
            flow: { start: vi.fn(), finish: vi.fn() },
            sdk: {
                refreshTokens,
                listEligibleAutonomousEvmGrants: vi.fn(),
                createWallet,
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: { authenticate: vi.fn(), clearSession },
        };

        const firstProcess = new PayboxCoordinator(options);
        const failure = firstProcess.authenticate({ force: false, payboxCredentialId: null });

        await expect(failure).rejects.toBe(refreshError);
        expect(firstProcess.isReady()).toBe(true);
        expect(firstProcess.get()).toBe(wallet);
        expect(persistedRecord).not.toBeNull();
        expect(persistedRecord).toMatchObject(storedRecord);
        expect(persistedRecord).toMatchObject({ refreshState });
        expect(clearSession).not.toHaveBeenCalled();

        const restartedProcess = new PayboxCoordinator(options);

        expect(restartedProcess.isReady()).toBe(true);
        expect(restartedProcess.get()).toBe(wallet);
        expect(refreshTokens).toHaveBeenCalledOnce();
        expect(clearSession).not.toHaveBeenCalled();
    });

    it('guards persisted refresh authority before exchange so restart cannot replay it', async () => {
        const storedTokens = {
            clientId: 'client',
            accessToken: 'old-access',
            refreshToken: 'single-use-refresh',
            expiresAt: Date.now() - 1,
            resource: 'https://api.paybox.test/mcp',
            baseUrl: 'https://api.paybox.test',
        };
        const rotatedTokens = {
            ...storedTokens,
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            expiresAt: Date.now() + 600_000,
        };
        let persistedRecord: PayboxAuthRecord | null = {
            version: 1,
            tokens: storedTokens,
            signingKey: 'pbxk1.test',
            credentialId: 'stored-credential',
            address: '0x0000000000000000000000000000000000000001',
        };
        const refreshTokens = vi.fn(async () => rotatedTokens);
        const save = vi.fn<IPayboxAuthStorage['save']>((record) => {
            if ('refreshState' in record && record.refreshState === 'exchange_pending') {
                persistedRecord = record;
                return;
            }
            throw new Error('disk full');
        });
        const clear = vi.fn(() => {
            persistedRecord = null;
        });
        const start = vi.fn(async () => ({ authorizationUrl: 'https://accounts.test/authorize?state=fresh' }));
        const options = {
            storage: { load: vi.fn(() => persistedRecord), save, clear },
            flow: { start, finish: vi.fn() },
            sdk: {
                refreshTokens,
                listEligibleAutonomousEvmGrants: vi.fn(),
                createWallet: vi.fn(() => wallet),
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(vi.fn(async () => 'game-jwt')),
        };

        const firstProcess = new PayboxCoordinator(options);
        await expect(firstProcess.authenticate({ force: false, payboxCredentialId: null })).rejects.toThrow(
            'disk full',
        );

        const restartedProcess = new PayboxCoordinator(options);
        await expect(restartedProcess.authenticate({ force: false, payboxCredentialId: null })).rejects.toMatchObject({
            data: { code: 'PAYBOX_TEMPORARILY_UNAVAILABLE', stateCleared: false, retryable: true },
        });

        expect(restartedProcess.isReady()).toBe(true);
        expect(restartedProcess.get()).toBe(wallet);
        expect(clear).not.toHaveBeenCalled();
        expect(refreshTokens).toHaveBeenCalledOnce();
        expect(refreshTokens).toHaveBeenCalledWith(storedTokens);
        expect(save.mock.invocationCallOrder[0]).toBeLessThan(refreshTokens.mock.invocationCallOrder[0] as number);
        expect(persistedRecord).toMatchObject({
            tokens: storedTokens,
            credentialId: 'stored-credential',
            refreshState: 'exchange_pending',
        });
        expect(start).not.toHaveBeenCalled();
    });

    it('rejects a refresh result invalidated while the SDK helper is unresolved', async () => {
        const storedTokens = {
            clientId: 'client',
            accessToken: 'old-access',
            refreshToken: 'old-refresh',
            expiresAt: Date.now() - 1,
            resource: 'https://api.paybox.test/mcp',
            baseUrl: 'https://api.paybox.test',
        };
        const rotatedTokens = {
            ...storedTokens,
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            expiresAt: Date.now() + 600_000,
        };
        const refresh = controlledPromise<typeof rotatedTokens>();
        const refreshTokens = vi.fn(() => refresh.promise);
        const save = vi.fn();
        const createWallet = vi.fn(() => wallet);
        const coordinator = new PayboxCoordinator({
            storage: {
                load: () => ({
                    version: 1,
                    tokens: storedTokens,
                    signingKey: 'pbxk1.test',
                    credentialId: 'stored-credential',
                    address: '0x0000000000000000000000000000000000000001',
                }),
                save,
                clear: vi.fn(),
            },
            flow: {
                start: vi.fn(async () => ({ authorizationUrl: 'https://accounts.test/authorize?state=fresh' })),
                finish: vi.fn(),
            },
            sdk: {
                refreshTokens,
                listEligibleAutonomousEvmGrants: vi.fn(),
                createWallet,
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(vi.fn()),
        });

        const staleAuthentication = coordinator.authenticate({ force: false, payboxCredentialId: null });
        await vi.waitFor(() => expect(refreshTokens).toHaveBeenCalledOnce());
        await expect(coordinator.authenticate({ force: true, payboxCredentialId: null })).resolves.toEqual(
            expect.objectContaining({ status: PayboxAuthStatus.AuthRequired }),
        );
        refresh.resolve(rotatedTokens);

        await expect(staleAuthentication).rejects.toThrow('invalidated');
        expect(save).toHaveBeenCalledOnce();
        expect(save).toHaveBeenCalledWith(expect.objectContaining({ refreshState: 'exchange_pending' }));
        expect(createWallet).toHaveBeenCalledOnce();
        expect(coordinator.isReady()).toBe(false);
    });

    it('restores partial bootstrap, refreshes it, and discovers grants without OAuth', async () => {
        const storedTokens = {
            clientId: 'client',
            accessToken: 'old-access',
            refreshToken: 'old-refresh',
            expiresAt: Date.now() - 1,
            resource: 'https://api.paybox.test/mcp',
            baseUrl: 'https://api.paybox.test',
        };
        const rotatedTokens = {
            ...storedTokens,
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            expiresAt: Date.now() + 600_000,
        };
        const start = vi.fn();
        const save = vi.fn();
        const listGrants = vi.fn(async () => ({
            grants: [
                {
                    credentialId: 'credential',
                    address: '0x0000000000000000000000000000000000000001',
                    label: null,
                    provider: null,
                },
            ],
            managementUrl: null,
        }));
        const coordinator = new PayboxCoordinator({
            storage: {
                load: () => ({
                    version: 1,
                    tokens: storedTokens,
                    signingKey: 'pbxk1.test',
                    credentialId: null,
                    address: null,
                }),
                save,
                clear: vi.fn(),
            },
            flow: { start, finish: vi.fn() },
            sdk: {
                refreshTokens: vi.fn(async () => rotatedTokens),
                listEligibleAutonomousEvmGrants: listGrants,
                createWallet: vi.fn(() => wallet),
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(vi.fn(async () => 'game-jwt')),
        });

        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual({
            status: PayboxAuthStatus.Authenticated,
            address: '0x0000000000000000000000000000000000000001',
        });

        expect(listGrants).toHaveBeenCalledWith(rotatedTokens, 'pbxk1.test');
        expect(save).toHaveBeenNthCalledWith(1, {
            version: 1,
            tokens: storedTokens,
            signingKey: 'pbxk1.test',
            credentialId: null,
            address: null,
            refreshState: 'exchange_pending',
        });
        expect(save).toHaveBeenNthCalledWith(2, {
            version: 1,
            tokens: rotatedTokens,
            signingKey: 'pbxk1.test',
            credentialId: null,
            address: null,
        });
        expect(save).toHaveBeenNthCalledWith(3, expect.objectContaining({ credentialId: 'credential' }));
        expect(start).not.toHaveBeenCalled();
    });

    it('refreshes restored authority before an ordinary signing request', async () => {
        const storedTokens = {
            clientId: 'client',
            accessToken: 'old-access',
            refreshToken: 'old-refresh',
            expiresAt: Date.now() - 1,
            resource: 'https://api.paybox.test/mcp',
            baseUrl: 'https://api.paybox.test',
        };
        const rotatedTokens = {
            ...storedTokens,
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            expiresAt: Date.now() + 600_000,
        };
        const signingAuthorities: Array<Awaited<ReturnType<PayboxWalletAuthority['current']>>> = [];
        const createWallet = vi.fn(
            (
                _tokens: Parameters<IPayboxSdkAdapter['createWallet']>[0],
                _signingKey: string,
                _credentialId: string,
                address: string,
                authority: PayboxWalletAuthority,
            ) =>
                ({
                    getAddress: () => address,
                    signMessage: async () => {
                        signingAuthorities.push(await authority.current());
                        return '0xsigned';
                    },
                }) as unknown as WalletManager,
        );
        const save = vi.fn();
        const coordinator = new PayboxCoordinator({
            storage: {
                load: () => ({
                    version: 1,
                    tokens: storedTokens,
                    signingKey: 'pbxk1.test',
                    credentialId: 'credential',
                    address: '0x0000000000000000000000000000000000000001',
                }),
                save,
                clear: vi.fn(),
            },
            flow: { start: vi.fn(), finish: vi.fn() },
            sdk: {
                refreshTokens: vi.fn(async () => rotatedTokens),
                listEligibleAutonomousEvmGrants: vi.fn(),
                createWallet,
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(vi.fn()),
        });

        await expect(coordinator.get().signMessage('economic intent')).resolves.toBe('0xsigned');

        expect(signingAuthorities).toEqual([{ tokens: rotatedTokens, signingKey: 'pbxk1.test' }]);
        expect(save).toHaveBeenCalledWith(
            expect.objectContaining({ tokens: rotatedTokens, credentialId: 'credential' }),
        );
        expect(createWallet).toHaveBeenCalledOnce();
    });

    it('fully resets refreshed authority after a retained Wallet receives a confirmed signing rejection', async () => {
        const storedTokens = {
            clientId: 'client',
            accessToken: 'old-access',
            refreshToken: 'old-refresh',
            expiresAt: Date.now() - 1,
            resource: 'https://api.paybox.test/mcp',
            baseUrl: 'https://api.paybox.test',
        };
        const rotatedTokens = {
            ...storedTokens,
            accessToken: 'new-access',
            refreshToken: 'new-refresh',
            expiresAt: Date.now() + 600_000,
        };
        let persisted: PayboxAuthRecord | null = {
            version: 1,
            tokens: storedTokens,
            signingKey: 'pbxk1.test',
            credentialId: 'credential',
            address: '0x0000000000000000000000000000000000000001',
        };
        const clear = vi.fn(() => {
            persisted = null;
        });
        const clearSession = vi.fn();
        const signMessage = vi.fn(async () => {
            throw new PayboxAuthInvalidError('Paybox rejected the refreshed signing authority.');
        });
        const walletSdk: IPayboxSdkAdapter = {
            refreshTokens: vi.fn(),
            listEligibleAutonomousEvmGrants: vi.fn(),
            createWallet: vi.fn(),
            signMessage,
            signTransaction: vi.fn(),
        };
        const createWallet = vi.fn(
            (
                _tokens: Parameters<IPayboxSdkAdapter['createWallet']>[0],
                _signingKey: string,
                credentialId: string,
                address: string,
                authority: PayboxWalletAuthority,
            ) =>
                new PayboxWalletManager({
                    sdk: walletSdk,
                    credentialId,
                    address,
                    authority,
                    rpc: {} as IPayboxRpcClient,
                    logger: new NoopLogger(),
                }),
        );
        const sdk: IPayboxSdkAdapter = {
            refreshTokens: vi.fn(async () => rotatedTokens),
            listEligibleAutonomousEvmGrants: vi.fn(),
            createWallet,
            signMessage,
            signTransaction: vi.fn(),
        };
        const coordinator = new PayboxCoordinator({
            storage: {
                load: () => persisted,
                save: vi.fn((record) => {
                    persisted = record;
                }),
                clear,
            },
            flow: { start: vi.fn(), finish: vi.fn() },
            sdk,
            authenticator: { authenticate: vi.fn(), clearSession },
        });
        const retainedWallet = coordinator.get();

        await expect(retainedWallet.signMessage('economic intent')).rejects.toBeInstanceOf(AuthenticationRequiredError);

        expect(signMessage).toHaveBeenCalledOnce();
        expect(clear).toHaveBeenCalledOnce();
        expect(clearSession).toHaveBeenCalledOnce();
        expect(persisted).toBeNull();
        expect(coordinator.isReady()).toBe(false);
        expect(() => coordinator.get()).toThrow('not authenticated');
    });

    it('requires an explicit fresh choice when multiple wallet grants are eligible', async () => {
        let saved = null as ReturnType<IPayboxAuthStorage['load']>;
        const storage: IPayboxAuthStorage = {
            load: vi.fn(() => saved),
            save: vi.fn((record) => {
                saved = record;
            }),
            clear: vi.fn(() => {
                saved = null;
            }),
        };
        const grants = [
            {
                credentialId: 'credential-a',
                address: '0x0000000000000000000000000000000000000001',
                label: 'First',
                provider: null,
            },
            {
                credentialId: 'credential-b',
                address: '0x0000000000000000000000000000000000000001',
                label: null,
                provider: 'Second provider',
            },
        ];
        const listGrants = vi.fn(async () => ({ grants, managementUrl: 'https://app.paybox.test' }));
        const createWallet = vi.fn(() => wallet);
        const coordinator = new PayboxCoordinator({
            storage,
            flow: {
                start: vi.fn(async () => ({ authorizationUrl: 'https://accounts.test/authorize?state=opaque' })),
                finish: vi.fn(async () => ({
                    tokens: {
                        clientId: 'client',
                        accessToken: 'access',
                        refreshToken: null,
                        expiresAt: null,
                        resource: null,
                        baseUrl: 'https://api.paybox.test',
                    },
                    signingKey: 'pbxk1.test',
                })),
            },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: listGrants,
                createWallet,
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(vi.fn(async () => 'game-jwt')),
        });

        await coordinator.authenticate({ force: false, payboxCredentialId: null });
        await coordinator.authenticate({ force: false, payboxCredentialId: null });
        await vi.waitFor(() => expect(listGrants).toHaveBeenCalledOnce());

        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual({
            status: 'wallet_selection_required',
            choices: grants,
        });
        expect(saved).toEqual(expect.objectContaining({ credentialId: null, address: null, signingKey: 'pbxk1.test' }));
        expect(createWallet).not.toHaveBeenCalled();

        await expect(coordinator.authenticate({ force: false, payboxCredentialId: 'credential-b' })).resolves.toEqual({
            status: PayboxAuthStatus.Authenticated,
            address: '0x0000000000000000000000000000000000000001',
        });
        expect(listGrants).toHaveBeenCalledTimes(2);
        expect(createWallet).toHaveBeenCalledWith(
            expect.anything(),
            'pbxk1.test',
            'credential-b',
            '0x0000000000000000000000000000000000000001',
            expect.anything(),
        );
        expect(saved).toEqual(expect.objectContaining({ credentialId: 'credential-b' }));
    });

    it('moves a disappeared choice with zero fresh grants into the corrective protocol', async () => {
        const tokens = {
            clientId: 'client',
            accessToken: 'access',
            refreshToken: null,
            expiresAt: null,
            resource: null,
            baseUrl: 'https://api.paybox.test',
        };
        let saved: ReturnType<IPayboxAuthStorage['load']> = {
            version: 1 as const,
            tokens,
            signingKey: 'pbxk1.test',
            credentialId: null,
            address: null,
        };
        const save = vi.fn<IPayboxAuthStorage['save']>((record) => {
            saved = record;
        });
        const grants = [
            {
                credentialId: 'credential-a',
                address: '0x0000000000000000000000000000000000000001',
                label: null,
                provider: null,
            },
            {
                credentialId: 'credential-b',
                address: '0x0000000000000000000000000000000000000002',
                label: null,
                provider: null,
            },
        ];
        const listGrants = vi
            .fn()
            .mockResolvedValueOnce({ grants, managementUrl: 'https://app.paybox.test' })
            .mockResolvedValue({ grants: [], managementUrl: 'https://app.paybox.test' });
        const createWallet = vi.fn(() => wallet);
        const authenticate = vi.fn(async () => 'game-jwt');
        const coordinator = new PayboxCoordinator({
            storage: { load: () => saved, save, clear: vi.fn() },
            flow: { start: vi.fn(), finish: vi.fn() },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: listGrants,
                createWallet,
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(authenticate),
        });

        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual({
            status: PayboxAuthStatus.WalletSelectionRequired,
            choices: grants,
        });
        await expect(coordinator.authenticate({ force: false, payboxCredentialId: 'credential-b' })).rejects.toThrow(
            'PAYBOX_WALLET_SELECTION_INVALID',
        );
        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).rejects.toThrow(
            'PAYBOX_FULL_ACCESS_WALLET_REQUIRED',
        );

        expect(listGrants).toHaveBeenCalledTimes(3);
        expect(save).toHaveBeenLastCalledWith({
            version: 1,
            tokens,
            signingKey: 'pbxk1.test',
            credentialId: null,
            address: null,
        });
        expect(createWallet).not.toHaveBeenCalled();
        expect(authenticate).not.toHaveBeenCalled();
        expect(coordinator.isReady()).toBe(false);
    });

    it('allows only one opaque identity to own an overlapping selection and SIWE flight', async () => {
        const tokens = {
            clientId: 'client',
            accessToken: 'access',
            refreshToken: null,
            expiresAt: null,
            resource: null,
            baseUrl: 'https://api.paybox.test',
        };
        const grants = [
            {
                credentialId: 'credential-a',
                address: '0x0000000000000000000000000000000000000001',
                label: null,
                provider: null,
            },
            {
                credentialId: 'credential-b',
                address: '0x0000000000000000000000000000000000000002',
                label: null,
                provider: null,
            },
        ];
        const walletA = { getAddress: () => grants[0]?.address } as unknown as WalletManager;
        const walletB = { getAddress: () => grants[1]?.address } as unknown as WalletManager;
        const save = vi.fn();
        const listGrants = vi.fn(async () => ({ grants, managementUrl: 'https://app.paybox.test' }));
        const createWallet = vi.fn(
            (_tokens: Parameters<IPayboxSdkAdapter['createWallet']>[0], _signingKey: string, credentialId: string) =>
                (credentialId === 'credential-a' ? walletA : walletB) as WalletManager,
        );
        const authentication = controlledPromise<string>();
        const authenticate = vi.fn((_wallet: WalletManager, _signal: AbortSignal) => authentication.promise);
        const coordinator = new PayboxCoordinator({
            storage: {
                load: () => ({
                    version: 1,
                    tokens,
                    signingKey: 'pbxk1.test',
                    credentialId: null,
                    address: null,
                }),
                save,
                clear: vi.fn(),
            },
            flow: { start: vi.fn(), finish: vi.fn() },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: listGrants,
                createWallet,
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(authenticate),
        });

        await coordinator.authenticate({ force: false, payboxCredentialId: null });
        const first = coordinator.authenticate({ force: false, payboxCredentialId: 'credential-a' });
        await vi.waitFor(() => expect(authenticate).toHaveBeenCalledOnce());
        const observer = coordinator.authenticate({ force: false, payboxCredentialId: null });
        const second = coordinator.authenticate({ force: false, payboxCredentialId: 'credential-b' });
        const secondResult = expect(second).rejects.toThrow('PAYBOX_WALLET_SELECTION_NOT_PENDING');
        await new Promise<void>((resolve) => setImmediate(resolve));
        authentication.resolve('game-jwt-a');

        await expect(Promise.all([first, observer])).resolves.toEqual([
            { status: PayboxAuthStatus.Authenticated, address: grants[0]?.address },
            { status: PayboxAuthStatus.Authenticated, address: grants[0]?.address },
        ]);
        await secondResult;
        expect(listGrants).toHaveBeenCalledTimes(2);
        expect(createWallet).toHaveBeenCalledOnce();
        expect(authenticate).toHaveBeenCalledOnce();
        expect(authenticate.mock.calls[0]?.[0]).toBe(walletA);
        expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ credentialId: 'credential-a' }));
        expect(coordinator.get()).toBe(walletA);
    });

    it('reports an injected unavailable loopback environment with the stable public error', async () => {
        const coordinator = new PayboxCoordinator({
            storage: { load: () => null, save: vi.fn(), clear: vi.fn() },
            flow: {
                start: vi.fn(async () => Promise.reject(new PayboxLoopbackUnavailableError('loopback unavailable'))),
                finish: vi.fn(),
            },
            sdk: {} as IPayboxSdkAdapter,
            authenticator: testAuthenticator(vi.fn()),
        });

        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).rejects.toThrow(
            'PAYBOX_AUTH_ENVIRONMENT_UNSUPPORTED',
        );
    });

    it('returns one safe pending state then persists the sole eligible grant', async () => {
        let saved = null as ReturnType<IPayboxAuthStorage['load']>;
        const storage: IPayboxAuthStorage = {
            load: vi.fn(() => saved),
            save: vi.fn((record) => {
                saved = record;
            }),
            clear: vi.fn(() => {
                saved = null;
            }),
        };
        const flow: PayboxAuthFlow = {
            start: vi.fn(async () => ({ authorizationUrl: 'https://accounts.test/authorize?state=opaque' })),
            finish: vi.fn(async () => ({
                tokens: {
                    clientId: 'client',
                    accessToken: 'access',
                    refreshToken: null,
                    expiresAt: null,
                    resource: null,
                    baseUrl: 'https://paybox.test',
                },
                signingKey: 'pbxk1.test',
            })),
        };
        const sdk: IPayboxSdkAdapter = {
            refreshTokens: vi.fn(),
            listEligibleAutonomousEvmGrants: vi.fn(async () => ({
                grants: [
                    {
                        credentialId: 'credential',
                        address: '0x0000000000000000000000000000000000000001',
                        label: null,
                        provider: null,
                    },
                ],
                managementUrl: null,
            })),
            createWallet: vi.fn(() => wallet),
            signMessage: vi.fn(),
            signTransaction: vi.fn(),
        };
        const authenticate = vi.fn(async () => 'game-jwt');
        const coordinator = new PayboxCoordinator({
            storage,
            flow,
            sdk,
            authenticator: testAuthenticator(authenticate),
        });
        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual(
            expect.objectContaining({ status: PayboxAuthStatus.AuthRequired }),
        );
        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual(
            expect.objectContaining({ status: PayboxAuthStatus.Authenticated }),
        );
        expect(authenticate).toHaveBeenCalledOnce();
        expect(storage.save).toHaveBeenCalledWith(
            expect.objectContaining({ credentialId: 'credential', signingKey: 'pbxk1.test' }),
        );
        expect(coordinator.get()).toBe(wallet);
        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual({
            status: PayboxAuthStatus.Authenticated,
            address: '0x0000000000000000000000000000000000000001',
        });
        expect(authenticate).toHaveBeenCalledTimes(2);
    });

    it('returns the same public state while browser completion remains unresolved', async () => {
        const finish = new Promise<never>(() => undefined);
        const coordinator = new PayboxCoordinator({
            storage: { load: () => null, save: vi.fn(), clear: vi.fn() },
            flow: {
                start: vi.fn(async () => ({ authorizationUrl: 'https://accounts.test/authorize?state=opaque' })),
                finish: vi.fn(() => finish),
            },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: vi.fn(),
                createWallet: vi.fn(),
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(vi.fn()),
        });
        const first = await coordinator.authenticate({ force: false, payboxCredentialId: null });
        const second = await Promise.race([
            coordinator.authenticate({ force: false, payboxCredentialId: null }),
            new Promise<never>((_, reject) => setImmediate(() => reject(new Error('blocked')))),
        ]);
        expect(first).toEqual(second);
        expect(second).toEqual(expect.objectContaining({ status: 'paybox_auth_required' }));
    });

    it('does not misclassify a protocol start error as unsupported loopback', async () => {
        const coordinator = new PayboxCoordinator({
            storage: { load: () => null, save: vi.fn(), clear: vi.fn() },
            flow: {
                start: vi.fn(async () => Promise.reject(new Error('PAYBOX_AUTH_FAILED: malformed discovery response'))),
                finish: vi.fn(),
            },
            sdk: {} as IPayboxSdkAdapter,
            authenticator: testAuthenticator(vi.fn()),
        });
        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).rejects.toThrow(
            'malformed discovery response',
        );
    });

    it('does not install authority from grant discovery invalidated by force', async () => {
        const grant = controlledPromise<{
            grants: Array<{
                credentialId: string;
                address: string;
                label: string | null;
                provider: string | null;
            }>;
            managementUrl: string | null;
        }>();
        const save = vi.fn();
        const createWallet = vi.fn(() => wallet);
        const listGrants = vi.fn(() => grant.promise);
        const coordinator = new PayboxCoordinator({
            storage: { load: () => null, save, clear: vi.fn() },
            flow: {
                start: vi.fn(async () => ({ authorizationUrl: 'https://accounts.test/authorize?state=opaque' })),
                finish: vi.fn(async () => ({
                    tokens: {
                        clientId: 'client',
                        accessToken: 'access',
                        refreshToken: null,
                        expiresAt: null,
                        resource: null,
                        baseUrl: 'https://paybox.test',
                    },
                    signingKey: 'pbxk1.test',
                })),
            },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: listGrants,
                createWallet,
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(vi.fn()),
        });

        await coordinator.authenticate({ force: false, payboxCredentialId: null });
        await coordinator.authenticate({ force: false, payboxCredentialId: null });
        await vi.waitFor(() => expect(listGrants).toHaveBeenCalledOnce());
        await coordinator.authenticate({ force: true, payboxCredentialId: null });
        grant.resolve({
            grants: [
                {
                    credentialId: 'stale-credential',
                    address: '0x0000000000000000000000000000000000000001',
                    label: null,
                    provider: null,
                },
            ],
            managementUrl: null,
        });
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(save).not.toHaveBeenCalled();
        expect(createWallet).not.toHaveBeenCalled();
        expect(coordinator.isReady()).toBe(false);
    });

    it('rejects auth material returned by flow finish after a forced reset', async () => {
        const completion = controlledPromise<{
            tokens: {
                clientId: string;
                accessToken: string;
                refreshToken: string | null;
                expiresAt: number | null;
                resource: string | null;
                baseUrl: string;
            };
            signingKey: string;
        }>();
        const start = vi
            .fn()
            .mockResolvedValueOnce({ authorizationUrl: 'https://accounts.test/authorize?state=stale' })
            .mockResolvedValueOnce({ authorizationUrl: 'https://accounts.test/authorize?state=current' });
        const finish = vi.fn(() => completion.promise);
        const save = vi.fn();
        const listGrants = vi.fn();
        const createWallet = vi.fn();
        const coordinator = new PayboxCoordinator({
            storage: { load: () => null, save, clear: vi.fn() },
            flow: { start, finish },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: listGrants,
                createWallet,
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(vi.fn()),
        });

        await coordinator.authenticate({ force: false, payboxCredentialId: null });
        await coordinator.authenticate({ force: false, payboxCredentialId: null });
        await vi.waitFor(() => expect(finish).toHaveBeenCalledOnce());
        await expect(coordinator.authenticate({ force: true, payboxCredentialId: null })).resolves.toEqual(
            expect.objectContaining({
                status: PayboxAuthStatus.AuthRequired,
                authorizationUrl: 'https://accounts.test/authorize?state=current',
            }),
        );

        completion.resolve({
            tokens: {
                clientId: 'stale-client',
                accessToken: 'stale-access',
                refreshToken: 'stale-refresh',
                expiresAt: null,
                resource: null,
                baseUrl: 'https://paybox.test',
            },
            signingKey: 'pbxk1.stale',
        });
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(listGrants).not.toHaveBeenCalled();
        expect(createWallet).not.toHaveBeenCalled();
        expect(save).not.toHaveBeenCalled();
        expect(coordinator.isReady()).toBe(false);
        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual(
            expect.objectContaining({
                status: PayboxAuthStatus.AuthRequired,
                authorizationUrl: 'https://accounts.test/authorize?state=current',
            }),
        );
        expect(start).toHaveBeenCalledTimes(2);
    });

    it('fails closed without reloading or retaining authority when force cannot clear storage', async () => {
        const load = vi.fn<IPayboxAuthStorage['load']>(() => ({
            version: 1 as const,
            tokens: {
                clientId: 'client',
                accessToken: 'access',
                refreshToken: null,
                expiresAt: null,
                resource: null,
                baseUrl: 'https://paybox.test',
            },
            signingKey: 'pbxk1.test',
            credentialId: 'credential',
            address: '0x0000000000000000000000000000000000000001',
        }));
        const clear = vi.fn(() => {
            throw new Error('storage clear failed');
        });
        const clearSession = vi.fn();
        const authenticate = vi.fn(async () => 'game-jwt');
        const coordinator = new PayboxCoordinator({
            storage: { load, save: vi.fn(), clear },
            flow: { start: vi.fn(), finish: vi.fn() },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: vi.fn(async () => selectedGrantList('credential')),
                createWallet: vi.fn(() => wallet),
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: { authenticate, clearSession },
        });

        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual(
            expect.objectContaining({ status: PayboxAuthStatus.Authenticated }),
        );
        await expect(coordinator.authenticate({ force: true, payboxCredentialId: null })).rejects.toThrow(
            'storage clear failed',
        );
        await expect(coordinator.authenticate({ force: true, payboxCredentialId: null })).rejects.toThrow(
            'storage clear failed',
        );

        expect(load).toHaveBeenCalledOnce();
        expect(clear).toHaveBeenCalledTimes(2);
        expect(clearSession).toHaveBeenCalledTimes(2);
        expect(authenticate).toHaveBeenCalledOnce();
        expect(coordinator.isReady()).toBe(false);
        expect(() => coordinator.get()).toThrow('not authenticated');
    });

    it('surfaces a completion failure once and permits an explicit browser retry', async () => {
        const start = vi
            .fn()
            .mockResolvedValueOnce({ authorizationUrl: 'https://accounts.test/authorize?state=first' })
            .mockResolvedValueOnce({ authorizationUrl: 'https://accounts.test/authorize?state=second' });
        const listGrants = vi.fn(async () => Promise.reject(new Error('wrong signer')));
        const coordinator = new PayboxCoordinator({
            storage: { load: () => null, save: vi.fn(), clear: vi.fn() },
            flow: {
                start,
                finish: vi.fn(async () => ({
                    tokens: {
                        clientId: 'client',
                        accessToken: 'access',
                        refreshToken: null,
                        expiresAt: null,
                        resource: null,
                        baseUrl: 'https://paybox.test',
                    },
                    signingKey: 'pbxk1.test',
                })),
            },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: listGrants,
                createWallet: vi.fn(),
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(vi.fn()),
        });

        await coordinator.authenticate({ force: false, payboxCredentialId: null });
        await coordinator.authenticate({ force: false, payboxCredentialId: null });
        await vi.waitFor(() => expect(listGrants).toHaveBeenCalledOnce());
        await new Promise<void>((resolve) => setImmediate(resolve));

        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).rejects.toThrow(
            'wrong signer',
        );
        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual(
            expect.objectContaining({
                status: PayboxAuthStatus.AuthRequired,
                authorizationUrl: 'https://accounts.test/authorize?state=second',
            }),
        );
        expect(start).toHaveBeenCalledTimes(2);
    });

    it('single-flights fresh SIWE for concurrent restored authentication calls', async () => {
        const authentication = controlledPromise<string>();
        const authenticate = vi.fn(() => authentication.promise);
        const coordinator = new PayboxCoordinator({
            storage: {
                load: () => ({
                    version: 1,
                    tokens: {
                        clientId: 'client',
                        accessToken: 'access',
                        refreshToken: null,
                        expiresAt: null,
                        resource: null,
                        baseUrl: 'https://paybox.test',
                    },
                    signingKey: 'pbxk1.test',
                    credentialId: 'credential',
                    address: '0x0000000000000000000000000000000000000001',
                }),
                save: vi.fn(),
                clear: vi.fn(),
            },
            flow: { start: vi.fn(), finish: vi.fn() },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: vi.fn(async () => selectedGrantList('credential')),
                createWallet: vi.fn(() => wallet),
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(authenticate),
        });

        const first = coordinator.authenticate({ force: false, payboxCredentialId: null });
        const second = coordinator.authenticate({ force: false, payboxCredentialId: null });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(authenticate).toHaveBeenCalledTimes(1);
        authentication.resolve('game-jwt');

        await expect(Promise.all([first, second])).resolves.toEqual([
            { status: PayboxAuthStatus.Authenticated, address: '0x0000000000000000000000000000000000000001' },
            { status: PayboxAuthStatus.Authenticated, address: '0x0000000000000000000000000000000000000001' },
        ]);
    });

    it('single-flights discovery and activation from stored auth-only material', async () => {
        const tokens = {
            clientId: 'client',
            accessToken: 'access',
            refreshToken: null,
            expiresAt: null,
            resource: null,
            baseUrl: 'https://paybox.test',
        };
        const discovery = controlledPromise<{
            grants: Array<{
                credentialId: string;
                address: string;
                label: string | null;
                provider: string | null;
            }>;
            managementUrl: string | null;
        }>();
        const authentication = controlledPromise<string>();
        const listGrants = vi.fn(() => discovery.promise);
        const createWallet = vi.fn(() => wallet);
        const save = vi.fn();
        const authenticate = vi.fn(() => authentication.promise);
        const coordinator = new PayboxCoordinator({
            storage: {
                load: vi.fn(() => ({
                    version: 1 as const,
                    tokens,
                    signingKey: 'pbxk1.test',
                    credentialId: null,
                    address: null,
                })),
                save,
                clear: vi.fn(),
            },
            flow: { start: vi.fn(), finish: vi.fn() },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: listGrants,
                createWallet,
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(authenticate),
        });

        const first = coordinator.authenticate({ force: false, payboxCredentialId: null });
        const second = coordinator.authenticate({ force: false, payboxCredentialId: null });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(listGrants).toHaveBeenCalledOnce();

        discovery.resolve({
            grants: [
                {
                    credentialId: 'credential',
                    address: '0x0000000000000000000000000000000000000001',
                    label: null,
                    provider: null,
                },
            ],
            managementUrl: null,
        });
        await vi.waitFor(() => expect(authenticate).toHaveBeenCalledOnce());
        expect(createWallet).toHaveBeenCalledOnce();
        expect(save).not.toHaveBeenCalled();

        authentication.resolve('game-jwt');
        await expect(Promise.all([first, second])).resolves.toEqual([
            { status: PayboxAuthStatus.Authenticated, address: '0x0000000000000000000000000000000000000001' },
            { status: PayboxAuthStatus.Authenticated, address: '0x0000000000000000000000000000000000000001' },
        ]);
        expect(listGrants).toHaveBeenCalledOnce();
        expect(createWallet).toHaveBeenCalledOnce();
        expect(authenticate).toHaveBeenCalledOnce();
        expect(save).toHaveBeenCalledOnce();
        expect(coordinator.get()).toBe(wallet);
    });

    it('keeps polling nonblocking while pending completion runs fresh SIWE', async () => {
        const authentication = controlledPromise<string>();
        const authenticate = vi.fn(() => authentication.promise);
        const start = vi.fn(async () => ({
            authorizationUrl: 'https://accounts.test/authorize?state=opaque',
        }));
        const coordinator = new PayboxCoordinator({
            storage: { load: () => null, save: vi.fn(), clear: vi.fn() },
            flow: {
                start,
                finish: vi.fn(async () => ({
                    tokens: {
                        clientId: 'client',
                        accessToken: 'access',
                        refreshToken: null,
                        expiresAt: null,
                        resource: null,
                        baseUrl: 'https://paybox.test',
                    },
                    signingKey: 'pbxk1.test',
                })),
            },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: vi.fn(async () => ({
                    grants: [
                        {
                            credentialId: 'credential',
                            address: '0x0000000000000000000000000000000000000001',
                            label: null,
                            provider: null,
                        },
                    ],
                    managementUrl: null,
                })),
                createWallet: vi.fn(() => wallet),
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(authenticate),
        });

        const pending = await coordinator.authenticate({ force: false, payboxCredentialId: null });
        await coordinator.authenticate({ force: false, payboxCredentialId: null });
        await vi.waitFor(() => expect(authenticate).toHaveBeenCalledOnce());
        const polled = await Promise.race([
            coordinator.authenticate({ force: false, payboxCredentialId: null }),
            new Promise<never>((_, reject) => setImmediate(() => reject(new Error('blocked')))),
        ]);

        expect(polled).toEqual(pending);
        expect(authenticate).toHaveBeenCalledOnce();
        expect(start).toHaveBeenCalledOnce();
        authentication.resolve('game-jwt');
        await new Promise<void>((resolve) => setImmediate(resolve));
    });

    it('does not persist or publish candidate authority before current SIWE succeeds', async () => {
        const authentication = controlledPromise<string>();
        const siweSignals = new Array<AbortSignal>();
        const save = vi.fn();
        const coordinator = new PayboxCoordinator({
            storage: { load: () => null, save, clear: vi.fn() },
            flow: {
                start: vi.fn(async () => ({ authorizationUrl: 'https://accounts.test/authorize?state=opaque' })),
                finish: vi.fn(async () => ({
                    tokens: {
                        clientId: 'client',
                        accessToken: 'access',
                        refreshToken: null,
                        expiresAt: null,
                        resource: null,
                        baseUrl: 'https://paybox.test',
                    },
                    signingKey: 'pbxk1.test',
                })),
            },
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: vi.fn(async () => ({
                    grants: [
                        {
                            credentialId: 'credential',
                            address: '0x0000000000000000000000000000000000000001',
                            label: null,
                            provider: null,
                        },
                    ],
                    managementUrl: null,
                })),
                createWallet: vi.fn(() => wallet),
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: testAuthenticator(
                vi.fn((_wallet, signal) => {
                    siweSignals.push(signal);
                    return authentication.promise;
                }),
            ),
        });

        await coordinator.authenticate({ force: false, payboxCredentialId: null });
        await coordinator.authenticate({ force: false, payboxCredentialId: null });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(save).not.toHaveBeenCalled();
        expect(coordinator.isReady()).toBe(false);

        await coordinator.authenticate({ force: true, payboxCredentialId: null });
        expect(siweSignals[0]?.aborted).toBe(true);
        authentication.resolve('stale-game-jwt');
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect(save).not.toHaveBeenCalled();
        expect(coordinator.isReady()).toBe(false);
    });
});

function controlledPromise<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolvePromise = (_value: T): void => undefined;
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: resolvePromise };
}

function testAuthenticator(authenticate: PayboxSiweAuthenticator['authenticate']): PayboxSiweAuthenticator {
    return { authenticate, clearSession: vi.fn() };
}

function selectedGrantList(credentialId: string) {
    return {
        grants: [
            {
                credentialId,
                address: '0x0000000000000000000000000000000000000001',
                label: null,
                provider: null,
            },
        ],
        managementUrl: null,
    };
}
