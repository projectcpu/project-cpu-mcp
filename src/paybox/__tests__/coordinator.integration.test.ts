import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, expect, it, vi } from 'vitest';

import { NoopLogger } from '../../logger/noop.logger.js';
import type { WalletManager } from '../../wallet/types.js';
import { PayboxCoordinator } from '../auth/coordinator.js';
import { PayboxTemporarilyUnavailableError } from '../errors.js';
import { PayboxAuthStorage } from '../storage.js';
import {
    PayboxAuthStatus,
    PayboxRefreshFailureDisposition,
    PayboxRefreshState,
    type PayboxAuthRecord,
} from '../types.js';

const directories = new Array<string>();
const signingKey =
    'pbxk1.eyJwIjoiMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMTExMSIsInMiOiIy' +
    'MjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyIn0';
const wallet = { getAddress: () => '0x0000000000000000000000000000000000000001' } as unknown as WalletManager;

afterEach(() => {
    for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true });
});

it.each([
    ['HTTP 429', PayboxRefreshFailureDisposition.SafeToRetry, PayboxRefreshState.Ready],
    ['HTTP 503', PayboxRefreshFailureDisposition.SafeToRetry, PayboxRefreshState.Ready],
    ['network failure', PayboxRefreshFailureDisposition.Ambiguous, PayboxRefreshState.Ready],
    ['timeout', PayboxRefreshFailureDisposition.Ambiguous, PayboxRefreshState.Ready],
])(
    'preserves paybox.json, selected manager, and game JWT across restart after refresh %s',
    async (_case, disposition, refreshState) => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-cpu-mcp-test-'));
        directories.push(home);
        const storage = new PayboxAuthStorage(home, new NoopLogger());
        const record: PayboxAuthRecord = {
            version: 1,
            tokens: {
                clientId: 'client',
                accessToken: 'access',
                refreshToken: 'single-use-refresh',
                expiresAt: Date.now() - 1,
                resource: 'https://api.paybox.test/mcp',
                baseUrl: 'https://api.paybox.test',
            },
            signingKey,
            credentialId: 'credential',
            address: '0x0000000000000000000000000000000000000001',
        };
        storage.save(record);
        const refreshTokens = vi.fn(async () =>
            Promise.reject(new PayboxTemporarilyUnavailableError(null, disposition)),
        );
        let gameJwt: string | null = 'game-jwt';
        const options = {
            storage,
            flow: { start: vi.fn(), finish: vi.fn() },
            sdk: {
                refreshTokens,
                listEligibleAutonomousEvmGrants: vi.fn(),
                createWallet: vi.fn(() => wallet),
                signMessage: vi.fn(),
                signTransaction: vi.fn(),
            },
            authenticator: {
                authenticate: vi.fn(),
                clearSession: vi.fn(() => {
                    gameJwt = null;
                }),
            },
        };

        const firstProcess = new PayboxCoordinator(options);
        await expect(firstProcess.authenticate({ force: false, payboxCredentialId: null })).rejects.toMatchObject({
            data: { code: 'PAYBOX_TEMPORARILY_UNAVAILABLE', stateCleared: false, retryable: true },
        });

        expect(storage.load()).toMatchObject({ ...record, refreshState });
        expect(firstProcess.isReady()).toBe(true);
        expect(firstProcess.get()).toBe(wallet);
        expect(gameJwt).toBe('game-jwt');

        const restartedProcess = new PayboxCoordinator(options);

        expect(restartedProcess.isReady()).toBe(true);
        expect(restartedProcess.get()).toBe(wallet);
        expect(refreshTokens).toHaveBeenCalledOnce();
        expect(gameJwt).toBe('game-jwt');
    },
);

it.each(['network failure', 'timeout'])(
    'retries an ambiguous refresh after restart following %s',
    async (failureCase) => {
        const home = fs.mkdtempSync(path.join(os.tmpdir(), 'project-cpu-mcp-test-'));
        directories.push(home);
        const storage = new PayboxAuthStorage(home, new NoopLogger());
        const tokens = {
            clientId: 'client',
            accessToken: 'access',
            refreshToken: 'single-use-refresh',
            expiresAt: Date.now() - 1,
            resource: 'https://api.paybox.test/mcp',
            baseUrl: 'https://api.paybox.test',
        };
        const rotatedTokens = {
            ...tokens,
            accessToken: 'rotated-access',
            refreshToken: 'rotated-refresh',
            expiresAt: Date.now() + 600_000,
        };
        storage.save({
            version: 1,
            tokens,
            signingKey,
            credentialId: 'credential',
            address: '0x0000000000000000000000000000000000000001',
        });
        const refreshError = new PayboxTemporarilyUnavailableError(
            failureCase === 'timeout'
                ? { cause: new DOMException('request timed out', 'TimeoutError') }
                : { cause: new TypeError('fetch failed') },
            PayboxRefreshFailureDisposition.Ambiguous,
        );
        const refreshTokens = vi.fn(async () => rotatedTokens);
        refreshTokens.mockRejectedValueOnce(refreshError);
        const options = {
            storage,
            flow: { start: vi.fn(), finish: vi.fn() },
            sdk: {
                refreshTokens,
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
            authenticator: { authenticate: vi.fn(async () => 'game-jwt'), clearSession: vi.fn() },
        };

        const firstProcess = new PayboxCoordinator(options);
        await expect(firstProcess.authenticate({ force: false, payboxCredentialId: null })).rejects.toBe(refreshError);

        const restartedProcess = new PayboxCoordinator(options);
        await expect(restartedProcess.authenticate({ force: false, payboxCredentialId: null })).resolves.toEqual({
            status: PayboxAuthStatus.Authenticated,
            address: '0x0000000000000000000000000000000000000001',
        });

        expect(refreshTokens).toHaveBeenCalledTimes(2);
        expect(storage.load()).toMatchObject({ tokens: rotatedTokens });
        expect(restartedProcess.isReady()).toBe(true);
    },
);
