import { describe, expect, it, vi } from 'vitest';

import type { WalletManager } from '../../wallet/types.js';
import { PayboxCoordinator } from '../coordinator.js';
import { PayboxLoopbackUnavailableError } from '../errors.js';
import { PayboxAuthStatus, type IPayboxAuthStorage, type IPayboxSdkAdapter, type PayboxAuthFlow } from '../types.js';

const wallet = { getAddress: () => '0x0000000000000000000000000000000000000001' } as unknown as WalletManager;

describe('PayboxCoordinator', () => {
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
                cancel: vi.fn(),
            },
            sdk: {
                listEligibleAutonomousEvmGrants: listGrants,
                createWallet,
                signMessage: vi.fn(),
            },
            authenticator: { authenticate: vi.fn(async () => 'game-jwt') },
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
        );
        expect(saved).toEqual(expect.objectContaining({ credentialId: 'credential-b' }));
    });

    it('reports an injected unavailable loopback environment with the stable public error', async () => {
        const coordinator = new PayboxCoordinator({
            storage: { load: () => null, save: vi.fn(), clear: vi.fn() },
            flow: {
                start: vi.fn(async () => Promise.reject(new PayboxLoopbackUnavailableError('loopback unavailable'))),
                finish: vi.fn(),
                cancel: vi.fn(),
            },
            sdk: {} as IPayboxSdkAdapter,
            authenticator: { authenticate: vi.fn() },
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
            cancel: vi.fn(),
        };
        const sdk: IPayboxSdkAdapter = {
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
        };
        const authenticate = vi.fn(async () => 'game-jwt');
        const coordinator = new PayboxCoordinator({ storage, flow, sdk, authenticator: { authenticate } });
        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual(
            expect.objectContaining({ status: PayboxAuthStatus.AuthRequired }),
        );
        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual(
            expect.objectContaining({ status: PayboxAuthStatus.AuthRequired }),
        );
        await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual({
            status: PayboxAuthStatus.Authenticated,
            address: '0x0000000000000000000000000000000000000001',
        });
        expect(storage.save).toHaveBeenCalledWith(
            expect.objectContaining({ credentialId: 'credential', signingKey: 'pbxk1.test' }),
        );
        expect(coordinator.get()).toBe(wallet);
        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual({
            status: PayboxAuthStatus.Authenticated,
            address: '0x0000000000000000000000000000000000000001',
        });
        expect(authenticate).toHaveBeenCalledTimes(3);
    });

    it('returns the same public state while browser completion remains unresolved', async () => {
        const finish = new Promise<never>(() => undefined);
        const coordinator = new PayboxCoordinator({
            storage: { load: () => null, save: vi.fn(), clear: vi.fn() },
            flow: {
                start: vi.fn(async () => ({ authorizationUrl: 'https://accounts.test/authorize?state=opaque' })),
                finish: vi.fn(() => finish),
                cancel: vi.fn(),
            },
            sdk: {
                listEligibleAutonomousEvmGrants: vi.fn(),
                createWallet: vi.fn(),
                signMessage: vi.fn(),
            },
            authenticator: { authenticate: vi.fn() },
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
                cancel: vi.fn(),
            },
            sdk: {} as IPayboxSdkAdapter,
            authenticator: { authenticate: vi.fn() },
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
                cancel: vi.fn(),
            },
            sdk: {
                listEligibleAutonomousEvmGrants: listGrants,
                createWallet,
                signMessage: vi.fn(),
            },
            authenticator: { authenticate: vi.fn() },
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
        const authenticate = vi.fn(async () => 'game-jwt');
        const coordinator = new PayboxCoordinator({
            storage: { load, save: vi.fn(), clear },
            flow: { start: vi.fn(), finish: vi.fn(), cancel: vi.fn() },
            sdk: {
                listEligibleAutonomousEvmGrants: vi.fn(),
                createWallet: vi.fn(() => wallet),
                signMessage: vi.fn(),
            },
            authenticator: { authenticate },
        });

        await expect(coordinator.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual(
            expect.objectContaining({ status: PayboxAuthStatus.Authenticated }),
        );
        await expect(coordinator.authenticate({ force: true, payboxCredentialId: null })).rejects.toThrow(
            'storage clear failed',
        );

        expect(load).toHaveBeenCalledOnce();
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
                cancel: vi.fn(),
            },
            sdk: {
                listEligibleAutonomousEvmGrants: listGrants,
                createWallet: vi.fn(),
                signMessage: vi.fn(),
            },
            authenticator: { authenticate: vi.fn() },
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
            flow: { start: vi.fn(), finish: vi.fn(), cancel: vi.fn() },
            sdk: {
                listEligibleAutonomousEvmGrants: vi.fn(),
                createWallet: vi.fn(() => wallet),
                signMessage: vi.fn(),
            },
            authenticator: { authenticate },
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
                cancel: vi.fn(),
            },
            sdk: {
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
            },
            authenticator: { authenticate },
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
                cancel: vi.fn(),
            },
            sdk: {
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
            },
            authenticator: {
                authenticate: vi.fn(() => authentication.promise),
            },
        });

        await coordinator.authenticate({ force: false, payboxCredentialId: null });
        await coordinator.authenticate({ force: false, payboxCredentialId: null });
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(save).not.toHaveBeenCalled();
        expect(coordinator.isReady()).toBe(false);

        await coordinator.authenticate({ force: true, payboxCredentialId: null });
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
