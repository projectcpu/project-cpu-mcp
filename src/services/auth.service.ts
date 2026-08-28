import { buildSiweMessage } from './siwe.utils.js';
import type { AuthServiceOptions } from './types.js';
import type { ApiClient } from '../api/client.js';
import { HttpStatus, type IAuthenticator, type SiweNonceResponse, type SiweVerifyResponse } from '../api/types.js';
import type { ILogger } from '../logger/types.js';
import { isJwtExpired } from '../session/jwt.utils.js';
import type { SessionManager } from '../session/manager.js';
import { SessionStatus } from '../session/types.js';
import type { WalletManager, WalletProvider } from '../wallet/types.js';

export class AuthService implements IAuthenticator {
    private readonly session: SessionManager;
    private readonly api: ApiClient;
    private readonly wallet: WalletProvider;
    private readonly logger: ILogger;

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

        return this.login(this.wallet.get(), new AbortController().signal);
    }

    async reauthenticate(): Promise<string> {
        this.logger.info('forcing SIWE re-login');
        return this.login(this.wallet.get(), new AbortController().signal);
    }

    // ---- SIWE (EVM mode) ----

    async authenticateSiwe(): Promise<string> {
        return this.login(this.wallet.get(), new AbortController().signal);
    }

    async authenticateWithWallet(wallet: WalletManager, signal: AbortSignal): Promise<string> {
        return this.login(wallet, signal);
    }

    private async login(wallet: WalletManager, signal: AbortSignal): Promise<string> {
        signal.throwIfAborted();
        const address = wallet.getAddress();
        const chainId = wallet.getChainId();

        this.logger.info('starting SIWE login', { address, chainId });

        const { data: nonce } = await this.api.request<SiweNonceResponse>(
            '/api/v1/auth/siwe/nonce',
            {
                method: 'POST',
                body: { address },
            },
            signal,
        );
        signal.throwIfAborted();

        const message = buildSiweMessage({
            address,
            chainId,
            apiUrl: this.api.getBaseUrl(),
            nonce: nonce.nonce,
            issuedAt: nonce.issuedAt,
            expirationTime: nonce.expirationTime,
        });

        const signature = await wallet.signMessage(message);
        signal.throwIfAborted();

        const { status, data: verified } = await this.api.request<SiweVerifyResponse>(
            '/api/v1/auth/siwe/verify',
            {
                method: 'POST',
                body: { message, signature },
            },
            signal,
        );

        if (status !== HttpStatus.Ok || !verified.accessToken) {
            throw new Error(`SIWE verification failed (status ${status})`);
        }
        signal.throwIfAborted();

        this.persistToken(address, verified.accessToken);

        this.logger.info('SIWE login completed', { address });
        return verified.accessToken;
    }

    private persistToken(address: string, jwt: string): void {
        const walletMode = this.session.getWalletMode();
        const current = this.session.getStatus() === SessionStatus.Active ? this.session.getSession() : null;
        if (
            current !== null &&
            (current.walletMode === undefined || current.walletMode === walletMode) &&
            (current.address === undefined || current.address.toLowerCase() === address.toLowerCase())
        ) {
            this.session.setJwt(jwt);
            return;
        }

        const now = new Date().toISOString();
        this.session.setSession({
            walletMode,
            address,
            jwt,
            createdAt: now,
            updatedAt: now,
        });
    }
}
