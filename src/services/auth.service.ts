import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

import { buildSiweMessage } from './siwe.utils.js';
import type { AuthServiceOptions, DeviceAuthResult } from './types.js';
import type { ApiClient } from '../api/client.js';
import {
    type DeviceAuthResponse,
    type DeviceTokenCompleteResponse,
    HttpStatus,
    type IAuthenticator,
    type SiweNonceResponse,
    type SiweVerifyResponse,
} from '../api/types.js';
import type { ILogger } from '../logger/types.js';
import { isJwtExpired } from '../session/jwt.utils.js';
import type { SessionManager } from '../session/manager.js';
import { SessionStatus } from '../session/types.js';
import { WalletMode } from '../types.js';
import { sleep } from '../utils/async.utils.js';
import type { WalletProvider } from '../wallet/types.js';

export class AuthService implements IAuthenticator {
    private readonly session: SessionManager;
    private readonly api: ApiClient;
    private readonly wallet: WalletProvider;
    private readonly logger: ILogger;

    private pendingAuth: DeviceAuthResult | null = null;

    constructor(options: AuthServiceOptions) {
        this.session = options.session;
        this.api = options.api;
        this.wallet = options.wallet;
        this.logger = options.logger;
    }

    // ---- IAuthenticator: token provider for ApiClient.authenticatedRequest ----

    async getAccessToken(): Promise<string> {
        if (this.session.getStatus() === SessionStatus.Active) {
            const { jwt } = this.session.getSession();
            if (jwt !== null && !isJwtExpired(jwt)) {
                return jwt;
            }
            this.logger.info('stored JWT missing or expired — re-running SIWE login');
        }

        return this.login();
    }

    async reauthenticate(): Promise<string> {
        this.logger.info('forcing SIWE re-login');
        return this.login();
    }

    // ---- SIWE (EVM mode) ----

    async authenticateSiwe(): Promise<string> {
        return this.login();
    }

    private async login(): Promise<string> {
        const wallet = this.wallet.get();
        const address = wallet.getAddress();
        const chainId = wallet.getChainId();

        this.logger.info('starting SIWE login', { address, chainId });

        const { data: nonce } = await this.api.request<SiweNonceResponse>('/api/v1/auth/siwe/nonce', {
            method: 'POST',
            body: { address },
        });

        const message = buildSiweMessage({
            address,
            chainId,
            apiUrl: this.api.getBaseUrl(),
            nonce: nonce.nonce,
            issuedAt: nonce.issuedAt,
            expirationTime: nonce.expirationTime,
        });

        const signature = await wallet.signMessage(message);

        const { status, data: verified } = await this.api.request<SiweVerifyResponse>('/api/v1/auth/siwe/verify', {
            method: 'POST',
            body: { message, signature },
        });

        if (status !== HttpStatus.Ok || !verified.accessToken) {
            throw new Error(`SIWE verification failed (status ${status})`);
        }

        this.persistToken(address, verified.accessToken);

        this.logger.info('SIWE login completed', { address });
        return verified.accessToken;
    }

    private persistToken(address: string, jwt: string): void {
        if (this.session.getStatus() === SessionStatus.Active) {
            this.session.setJwt(jwt);
            return;
        }

        const now = new Date().toISOString();
        this.session.setSession({
            walletMode: WalletMode.EVM,
            address,
            sessionPrivateKey: null,
            jwt,
            sessionConfig: null,
            createdAt: now,
            updatedAt: now,
        });
    }

    // ---- Device Authorization (AGW mode) ----

    getPendingAuth(): DeviceAuthResult | null {
        return this.pendingAuth;
    }

    async authenticateDevice(): Promise<DeviceAuthResult> {
        const sessionPrivateKey = generatePrivateKey();
        const account = privateKeyToAccount(sessionPrivateKey);
        const signerAddress = account.address;

        this.logger.info('starting device auth', { signerAddress });

        const { data: deviceAuth } = await this.api.request<DeviceAuthResponse>('/api/v1/auth/device/start', {
            method: 'POST',
            body: { signerAddress },
        });

        const verificationUrl = `${deviceAuth.verificationUri}?code=${deviceAuth.userCode}`;

        const result: DeviceAuthResult = {
            verificationUrl,
            userCode: deviceAuth.userCode,
        };

        this.pendingAuth = result;

        this.pollUntilComplete(
            deviceAuth.deviceCode,
            deviceAuth.interval,
            deviceAuth.expiresIn,
            sessionPrivateKey,
            signerAddress,
        )
            .catch((error) => {
                this.logger.error('device auth polling failed', {
                    error,
                });
            })
            .finally(() => {
                this.pendingAuth = null;
            });

        this.logger.info('device auth started — user must open URL', { url: verificationUrl });
        return result;
    }

    private async pollUntilComplete(
        deviceCode: string,
        intervalS: number,
        expiresInS: number,
        sessionPrivateKey: `0x${string}`,
        signerAddress: string,
    ): Promise<void> {
        const deadline = Date.now() + expiresInS * 1000;

        while (Date.now() < deadline) {
            await sleep(intervalS * 1000);

            const { status, data } = await this.api.request<DeviceTokenCompleteResponse>('/api/v1/auth/device/token', {
                method: 'POST',
                body: { deviceCode },
            });

            if (status === HttpStatus.Accepted) {
                this.logger.debug('device auth still pending');
                continue;
            }

            if (status !== HttpStatus.Ok) {
                throw new Error(`Device auth polling failed: ${status}`);
            }

            const now = new Date().toISOString();

            this.session.setSession({
                walletMode: WalletMode.AGW,
                address: signerAddress,
                sessionPrivateKey,
                jwt: null,
                sessionConfig: data.sessionConfig,
                createdAt: now,
                updatedAt: now,
            });

            this.logger.info('device auth completed', { address: signerAddress });
            return;
        }

        throw new Error('Device authorization timed out. Please try again.');
    }
}
