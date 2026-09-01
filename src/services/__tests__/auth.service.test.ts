import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiClient } from '../../api/client.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { SessionManager } from '../../session/manager.js';
import { type SessionData, SessionStatus } from '../../session/types.js';
import { WalletMode } from '../../types.js';
import type { WalletManager, WalletProvider } from '../../wallet/types.js';
import { AuthService } from '../auth.service.js';

vi.mock('../../api/client.js');
vi.mock('../../session/manager.js');

const logger = new NoopLogger();

// Fixed Anvil test key → a real, EIP-55-checksummed address that viem's createSiweMessage accepts.
const TEST_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const ADDRESS = privateKeyToAccount(TEST_KEY).address;
const OTHER_ADDRESS = '0x1111111111111111111111111111111111111111';

/** Builds a JWT whose payload carries `exp` (unix seconds) — only the payload is decoded. */
function buildJwt(expSeconds: number, address = ADDRESS): string {
    const payload = Buffer.from(JSON.stringify({ address, exp: expSeconds })).toString('base64url');
    return `header.${payload}.signature`;
}

describe('AuthService', () => {
    let session: SessionManager;
    let api: ApiClient;
    let wallet: WalletProvider;
    let walletManager: WalletManager;
    let service: AuthService;

    beforeEach(() => {
        vi.resetAllMocks();

        session = new SessionManager(null as never);
        api = new ApiClient(null as never);
        vi.mocked(session.getWalletMode).mockReturnValue(WalletMode.EVM);

        walletManager = {
            getAddress: vi.fn(() => ADDRESS),
            getChainId: vi.fn(() => 1),
            sendTransaction: vi.fn(),
            signMessage: vi.fn(async () => '0xsignature'),
        } as unknown as WalletManager;
        wallet = { get: () => walletManager, isReady: () => true };

        service = new AuthService({ session, api, wallet, logger });

        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe('SIWE', () => {
        // Nonce must satisfy viem's EIP-4361 rules (alphanumeric, >= 8 chars).
        const nonceResponse = () => ({
            status: 200,
            headers: new Headers(),
            data: {
                nonce: 'abc123def456',
                issuedAt: new Date(Date.now()).toISOString(),
                expirationTime: new Date(Date.now() + 600_000).toISOString(),
            },
        });
        const verifyResponse = () => ({
            status: 200,
            headers: new Headers(),
            data: { accessToken: 'jwt-token', user: { id: 'user-1', address: ADDRESS.toLowerCase() } },
        });

        describe('error cases', () => {
            it('throws when verify returns a non-200 status', async () => {
                vi.mocked(session.getStatus).mockReturnValue(SessionStatus.Missing);
                vi.mocked(api.getBaseUrl).mockReturnValue('https://api.test.com');
                vi.mocked(api.request).mockResolvedValueOnce(nonceResponse());
                vi.mocked(api.request).mockResolvedValueOnce({ status: 401, headers: new Headers(), data: {} });

                await expect(service.authenticateSiwe()).rejects.toThrow(/SIWE verification failed/);
                expect(session.setSession).not.toHaveBeenCalled();
            });
        });

        describe('getAccessToken', () => {
            it('returns the cached JWT without re-login when valid', async () => {
                const validJwt = buildJwt(Math.floor(Date.now() / 1000) + 3600);
                vi.mocked(session.getStatus).mockReturnValue(SessionStatus.Active);
                vi.mocked(session.getSession).mockReturnValue({ address: ADDRESS, jwt: validJwt } as SessionData);

                const token = await service.getAccessToken();

                expect(token).toBe(validJwt);
                expect(api.request).not.toHaveBeenCalled();
            });

            it('re-runs SIWE when the stored session belongs to another wallet', async () => {
                const validJwt = buildJwt(Math.floor(Date.now() / 1000) + 3600);
                vi.mocked(session.getStatus).mockReturnValue(SessionStatus.Active);
                vi.mocked(session.getSession).mockReturnValue({ address: OTHER_ADDRESS, jwt: validJwt } as SessionData);
                vi.mocked(api.getBaseUrl).mockReturnValue('https://api.test.com');
                vi.mocked(api.request).mockResolvedValueOnce(nonceResponse());
                vi.mocked(api.request).mockResolvedValueOnce(verifyResponse());

                const token = await service.getAccessToken();

                expect(token).toBe('jwt-token');
                expect(walletManager.signMessage).toHaveBeenCalledOnce();
                expect(session.setJwt).not.toHaveBeenCalled();
                expect(session.setSession).toHaveBeenCalledWith({
                    walletMode: WalletMode.EVM,
                    address: ADDRESS,
                    jwt: 'jwt-token',
                    createdAt: expect.any(String),
                    updatedAt: expect.any(String),
                });
            });

            it('re-runs SIWE when a legacy session address hides a JWT for another wallet', async () => {
                const staleJwt = buildJwt(Math.floor(Date.now() / 1000) + 3600, OTHER_ADDRESS);
                vi.mocked(session.getStatus).mockReturnValue(SessionStatus.Active);
                vi.mocked(session.getSession).mockReturnValue({ address: ADDRESS, jwt: staleJwt } as SessionData);
                vi.mocked(api.getBaseUrl).mockReturnValue('https://api.test.com');
                vi.mocked(api.request).mockResolvedValueOnce(nonceResponse());
                vi.mocked(api.request).mockResolvedValueOnce(verifyResponse());

                const token = await service.getAccessToken();

                expect(token).toBe('jwt-token');
                expect(walletManager.signMessage).toHaveBeenCalledOnce();
                expect(session.setJwt).toHaveBeenCalledWith('jwt-token');
            });

            it('re-runs SIWE when the stored JWT is expired', async () => {
                const expiredJwt = buildJwt(Math.floor(Date.now() / 1000) - 60);
                vi.mocked(session.getStatus).mockReturnValue(SessionStatus.Active);
                vi.mocked(session.getSession).mockReturnValue({ address: ADDRESS, jwt: expiredJwt } as SessionData);
                vi.mocked(api.getBaseUrl).mockReturnValue('https://api.test.com');
                vi.mocked(api.request).mockResolvedValueOnce(nonceResponse());
                vi.mocked(api.request).mockResolvedValueOnce(verifyResponse());

                const token = await service.getAccessToken();

                expect(token).toBe('jwt-token');
                expect(walletManager.signMessage).toHaveBeenCalledOnce();
                expect(session.setJwt).toHaveBeenCalledWith('jwt-token');
            });
        });

        describe('reauthenticate', () => {
            it('re-runs SIWE login even when a valid JWT is cached', async () => {
                const validJwt = buildJwt(Math.floor(Date.now() / 1000) + 3600);
                vi.mocked(session.getStatus).mockReturnValue(SessionStatus.Active);
                vi.mocked(session.getSession).mockReturnValue({ address: ADDRESS, jwt: validJwt } as SessionData);
                vi.mocked(api.getBaseUrl).mockReturnValue('https://api.test.com');
                vi.mocked(api.request).mockResolvedValueOnce(nonceResponse());
                vi.mocked(api.request).mockResolvedValueOnce(verifyResponse());

                const token = await service.reauthenticate();

                expect(token).toBe('jwt-token');
                expect(walletManager.signMessage).toHaveBeenCalledOnce();
                expect(session.setJwt).toHaveBeenCalledWith('jwt-token');
            });
        });

        describe('login', () => {
            it('runs nonce -> sign -> verify and persists a fresh session on first login', async () => {
                vi.mocked(session.getStatus).mockReturnValue(SessionStatus.Missing);
                vi.mocked(api.getBaseUrl).mockReturnValue('https://api.test.com');
                vi.mocked(api.request).mockResolvedValueOnce(nonceResponse());
                vi.mocked(api.request).mockResolvedValueOnce(verifyResponse());

                const token = await service.authenticateSiwe();

                expect(token).toBe('jwt-token');
                expect(api.request).toHaveBeenCalledWith(
                    '/api/v1/auth/siwe/nonce',
                    {
                        method: 'POST',
                        body: { address: ADDRESS },
                    },
                    expect.any(AbortSignal),
                );
                expect(walletManager.signMessage).toHaveBeenCalledOnce();
                expect(api.request).toHaveBeenCalledWith(
                    '/api/v1/auth/siwe/verify',
                    expect.objectContaining({
                        method: 'POST',
                        body: expect.objectContaining({ signature: '0xsignature' }),
                    }),
                    expect.any(AbortSignal),
                );
                expect(session.setSession).toHaveBeenCalledWith(
                    expect.objectContaining({
                        walletMode: WalletMode.EVM,
                        address: ADDRESS,
                        jwt: 'jwt-token',
                    }),
                );
            });

            it('does not persist a SIWE result invalidated while verification is pending', async () => {
                const controller = new AbortController();
                const verification = controlledPromise<ReturnType<typeof verifyResponse>>();
                vi.mocked(session.getStatus).mockReturnValue(SessionStatus.Missing);
                vi.mocked(api.getBaseUrl).mockReturnValue('https://api.test.com');
                vi.mocked(api.request).mockResolvedValueOnce(nonceResponse());
                vi.mocked(api.request).mockImplementationOnce(() => verification.promise);

                const authentication = service.authenticateWithWallet(walletManager, controller.signal);
                await vi.waitFor(() => expect(api.request).toHaveBeenCalledTimes(2));
                controller.abort(new Error('Authentication was invalidated.'));
                verification.resolve(verifyResponse());

                await expect(authentication).rejects.toThrow('invalidated');
                expect(session.setSession).not.toHaveBeenCalled();
                expect(session.setJwt).not.toHaveBeenCalled();
            });
        });
    });
});

function controlledPromise<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
    let resolvePromise = (_value: T): void => undefined;
    const promise = new Promise<T>((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: resolvePromise };
}
