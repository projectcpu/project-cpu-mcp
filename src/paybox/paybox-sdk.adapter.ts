import { defaultPayboxSdkClientFactory } from './paybox-sdk.factory.js';
import { PayboxWalletManager } from './paybox-wallet.manager.js';
import { oneAutonomousEvmGrant, signatureFromResponse } from './sdk.utils.js';
import type { IPayboxSdkAdapter, PayboxSdkClient, PayboxSdkClientFactory, PayboxTokens } from './types.js';
import type { WalletManager } from '../wallet/types.js';

export class PayboxSdkAdapter implements IPayboxSdkAdapter {
    public constructor(private readonly factory: PayboxSdkClientFactory = defaultPayboxSdkClientFactory) {}

    public async selectOneAutonomousEvmGrant(
        tokens: PayboxTokens,
        signingKey: string,
    ): Promise<{ credentialId: string; address: string }> {
        return oneAutonomousEvmGrant(await this.client(tokens, signingKey).listCredentials());
    }

    public createWallet(
        tokens: PayboxTokens,
        signingKey: string,
        credentialId: string,
        address: string,
    ): WalletManager {
        return new PayboxWalletManager(this, tokens, signingKey, credentialId, address);
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
