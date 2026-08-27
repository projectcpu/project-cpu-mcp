import { defaultPayboxSdkClientFactory, defaultPayboxTokenRefresher } from './paybox-sdk.factory.js';
import { PayboxWalletManager } from './paybox-wallet.manager.js';
import { autonomousEvmGrants, signatureFromResponse } from './sdk.utils.js';
import { payboxTokensSchema } from './types.js';
import type {
    EligiblePayboxGrantList,
    IPayboxSdkAdapter,
    PayboxSdkClient,
    PayboxSdkClientFactory,
    PayboxTokenRefresher,
    PayboxTokens,
    PayboxWalletAuthority,
} from './types.js';
import type { WalletManager } from '../wallet/types.js';

export class PayboxSdkAdapter implements IPayboxSdkAdapter {
    public constructor(
        private readonly factory: PayboxSdkClientFactory = defaultPayboxSdkClientFactory,
        private readonly refresher: PayboxTokenRefresher = defaultPayboxTokenRefresher,
    ) {}

    public async refreshTokens(tokens: PayboxTokens): Promise<PayboxTokens> {
        const refreshed = await this.refresher.refresh(tokens.baseUrl, {
            clientId: tokens.clientId,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiresAt: tokens.expiresAt,
            resource: tokens.resource,
        });
        return payboxTokensSchema.parse({
            ...refreshed,
            baseUrl: tokens.baseUrl,
        });
    }

    public async listEligibleAutonomousEvmGrants(
        tokens: PayboxTokens,
        signingKey: string,
    ): Promise<EligiblePayboxGrantList> {
        return autonomousEvmGrants(await this.client(tokens, signingKey).listCredentials(), tokens.baseUrl);
    }

    public createWallet(
        tokens: PayboxTokens,
        signingKey: string,
        credentialId: string,
        address: string,
        authority: PayboxWalletAuthority,
    ): WalletManager {
        return new PayboxWalletManager(this, tokens, signingKey, credentialId, address, authority);
    }

    public async signMessage(
        tokens: PayboxTokens,
        signingKey: string,
        credentialId: string,
        message: string,
    ): Promise<string> {
        const response = await this.client(tokens, signingKey).requestWalletSign(
            { credentialId, intent: { op: 'message', message } },
            { autoSign: true },
        );
        return signatureFromResponse(response, credentialId);
    }

    private client(tokens: PayboxTokens, signingKey: string): PayboxSdkClient {
        return this.factory.create({ baseUrl: tokens.baseUrl, token: tokens.accessToken, signingKey });
    }
}
