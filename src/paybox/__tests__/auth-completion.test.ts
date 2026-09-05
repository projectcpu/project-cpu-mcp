import { describe, expect, it, vi } from 'vitest';

import type { WalletManager } from '../../wallet/types.js';
import { PayboxCoordinator } from '../auth/coordinator.js';
import { PayboxAuthStatus, type PayboxAuthMaterial } from '../types.js';

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((accept) => {
        resolve = accept;
    });
    return { promise, resolve };
}

function scenario() {
    const material = deferred<PayboxAuthMaterial>();
    const gameLogin = deferred<string>();
    const address = '0x0000000000000000000000000000000000000001';
    const start = vi.fn(async () => ({ authorizationUrl: 'https://app.paybox.test/connect?user_code=TEST' }));
    const finish = vi.fn(() => material.promise);
    const save = vi.fn();
    const authenticate = vi.fn(() => gameLogin.promise);
    const coordinator = new PayboxCoordinator({
        storage: { load: () => null, save, clear: vi.fn() },
        flow: { start, finish },
        sdk: {
            refreshTokens: vi.fn(),
            listEligibleAutonomousEvmGrants: vi.fn(async () => ({
                grants: [{ credentialId: 'credential', address, label: 'Test wallet', provider: null }],
                managementUrl: null,
            })),
            createWallet: vi.fn(() => ({ getAddress: () => address }) as unknown as WalletManager),
            signMessage: vi.fn(),
            signTransaction: vi.fn(),
        },
        authenticator: { authenticate, clearSession: vi.fn() },
    });
    const submitKey = () =>
        material.resolve({
            tokens: {
                clientId: 'client',
                baseUrl: 'https://api.paybox.test',
                accessToken: 'test-access',
                refreshToken: 'test-refresh',
                expiresAt: null,
                resource: 'https://api.paybox.test/mcp',
            },
            signingKey: 'pbxk1.test',
        });
    const poll = () => coordinator.authenticate({ force: false, payboxCredentialId: null });
    return { coordinator, start, finish, save, authenticate, gameLogin, submitKey, poll };
}

describe('authentication completion after browser key submission', () => {
    it('persists a completed browser login without requiring another tool call to start finalization', async () => {
        const test = scenario();
        await expect(test.poll()).resolves.toMatchObject({ status: PayboxAuthStatus.AuthRequired });
        test.submitKey();
        test.gameLogin.resolve('game-jwt');

        await vi.waitFor(() => expect(test.save).toHaveBeenCalledOnce(), { timeout: 100 });
        expect(test.coordinator.isReady()).toBe(true);
        await expect(test.poll()).resolves.toMatchObject({ status: PayboxAuthStatus.Authenticated });
        expect(test.start).toHaveBeenCalledOnce();
    });

    it('does not return an old authorization URL to concurrent polls after credentials are saved', async () => {
        const test = scenario();
        await test.poll();
        test.submitKey();
        test.gameLogin.resolve('game-jwt');

        const results = await Promise.all(Array.from({ length: 10 }, () => test.poll()));

        expect(test.save).toHaveBeenCalledOnce();
        expect(test.coordinator.isReady()).toBe(true);
        expect(results.every((result) => result.status === PayboxAuthStatus.Authenticated)).toBe(true);
    });

    it('does not ask for browser authorization while a submitted key is being used to finish game login', async () => {
        const test = scenario();
        await test.poll();
        test.submitKey();
        await test.poll();
        await vi.waitFor(() => expect(test.authenticate).toHaveBeenCalledOnce());

        const pending = await test.poll();

        expect(pending.status).toBe(PayboxAuthStatus.Authenticating);
        expect(pending).not.toHaveProperty('authorizationUrl');
        expect(test.save).not.toHaveBeenCalled();
        test.gameLogin.resolve('game-jwt');
        await vi.waitFor(() => expect(test.save).toHaveBeenCalledOnce());
        await expect(test.poll()).resolves.toMatchObject({ status: PayboxAuthStatus.Authenticated });
    });
});
