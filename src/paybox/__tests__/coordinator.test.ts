import { describe, expect, it, vi } from 'vitest';

import type { WalletManager } from '../../wallet/types.js';
import { PayboxCoordinator } from '../coordinator.js';
import {
    PayboxAuthStatus,
    PayboxLoopbackUnavailableError,
    type IPayboxAuthStorage,
    type IPayboxSdkAdapter,
    type PayboxAuthFlow,
} from '../types.js';

const wallet = { getAddress: () => '0x0000000000000000000000000000000000000001' } as unknown as WalletManager;

describe('PayboxCoordinator', () => {
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

        await expect(coordinator.authenticate({ force: false })).rejects.toThrow('PAYBOX_AUTH_ENVIRONMENT_UNSUPPORTED');
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
            selectOneAutonomousEvmGrant: vi.fn(async () => ({
                credentialId: 'credential',
                address: '0x0000000000000000000000000000000000000001',
            })),
            createWallet: vi.fn(() => wallet),
            signMessage: vi.fn(),
        };
        const authenticate = vi.fn(async () => 'game-jwt');
        const coordinator = new PayboxCoordinator({ storage, flow, sdk, authenticator: { authenticate } });
        await expect(coordinator.authenticate({ force: false })).resolves.toEqual(
            expect.objectContaining({ status: PayboxAuthStatus.AuthRequired }),
        );
        await expect(coordinator.authenticate({ force: false })).resolves.toEqual(
            expect.objectContaining({ status: PayboxAuthStatus.AuthRequired }),
        );
        await vi.waitFor(() => expect(authenticate).toHaveBeenCalledTimes(1));
        await expect(coordinator.authenticate({ force: false })).resolves.toEqual({
            status: PayboxAuthStatus.Authenticated,
            address: '0x0000000000000000000000000000000000000001',
        });
        expect(storage.save).toHaveBeenCalledWith(
            expect.objectContaining({ credentialId: 'credential', signingKey: 'pbxk1.test' }),
        );
        expect(coordinator.get()).toBe(wallet);
        await expect(coordinator.authenticate({ force: false })).resolves.toEqual({
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
            sdk: { selectOneAutonomousEvmGrant: vi.fn(), createWallet: vi.fn(), signMessage: vi.fn() },
            authenticator: { authenticate: vi.fn() },
        });
        const first = await coordinator.authenticate({ force: false });
        const second = await Promise.race([
            coordinator.authenticate({ force: false }),
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
        await expect(coordinator.authenticate({ force: false })).rejects.toThrow('malformed discovery response');
    });
});
