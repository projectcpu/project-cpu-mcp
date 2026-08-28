import { PayboxRpcClient } from './paybox-rpc.client.js';
import { defaultPayboxSdkClientFactory, defaultPayboxTokenRefresher } from './paybox-sdk.factory.js';
import { PayboxWalletManager } from './paybox-wallet.manager.js';
import {
    autonomousEvmGrants,
    classifiedPayboxError,
    serializedTransactionFromResponse,
    signatureFromResponse,
} from './sdk.utils.js';
import { PayboxRequestContext, payboxTokensSchema } from './types.js';
import type {
    EligiblePayboxGrantList,
    IPayboxSdkAdapter,
    PayboxSdkClient,
    PayboxSdkClientFactory,
    PayboxSdkWalletOptions,
    PayboxTransactionIntent,
    PayboxTokenRefresher,
    PayboxTokens,
    PayboxWalletAuthority,
} from './types.js';
import { NoopLogger } from '../logger/noop.logger.js';
import type { WalletManager } from '../wallet/types.js';

export class PayboxSdkAdapter implements IPayboxSdkAdapter {
    public constructor(
        private readonly factory: PayboxSdkClientFactory = defaultPayboxSdkClientFactory,
        private readonly refresher: PayboxTokenRefresher = defaultPayboxTokenRefresher,
        private readonly walletOptions: PayboxSdkWalletOptions = { rpcUrl: null, logger: new NoopLogger() },
    ) {}

    public async refreshTokens(tokens: PayboxTokens): Promise<PayboxTokens> {
        try {
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
        } catch (error) {
            throw classifiedPayboxError(error, PayboxRequestContext.Refresh);
        }
    }

    public async listEligibleAutonomousEvmGrants(
        tokens: PayboxTokens,
        signingKey: string,
    ): Promise<EligiblePayboxGrantList> {
        try {
            const response = await this.client(tokens, signingKey).listCredentials();
            return autonomousEvmGrants(response, tokens.baseUrl);
        } catch (error) {
            throw classifiedPayboxError(error, PayboxRequestContext.Authenticated);
        }
    }

    public createWallet(
        _tokens: PayboxTokens,
        _signingKey: string,
        credentialId: string,
        address: string,
        authority: PayboxWalletAuthority,
    ): WalletManager {
        return new PayboxWalletManager({
            sdk: this,
            credentialId,
            address,
            authority,
            rpc: new PayboxRpcClient({ rpcUrl: this.walletOptions.rpcUrl }),
            logger: this.walletOptions.logger,
        });
    }

    public async signMessage(
        tokens: PayboxTokens,
        signingKey: string,
        credentialId: string,
        message: string,
    ): Promise<string> {
        let response;
        try {
            response = await this.client(tokens, signingKey).requestWalletSign(
                { credentialId, intent: { op: 'message', message } },
                { autoSign: true },
            );
        } catch (error) {
            throw classifiedPayboxError(error, PayboxRequestContext.Authenticated);
        }
        return signatureFromResponse(response, credentialId);
    }

    public async signTransaction(
        tokens: PayboxTokens,
        signingKey: string,
        credentialId: string,
        intent: PayboxTransactionIntent,
    ): Promise<`0x${string}`> {
        let response;
        try {
            response = await this.client(tokens, signingKey).requestWalletSign(
                {
                    credentialId,
                    intent: {
                        op: 'transaction',
                        transaction: {
                            to: intent.to,
                            value: intent.value.toString(),
                            data: intent.data,
                            chainId: intent.chainId,
                            gas: intent.gas.toString(),
                            maxPriorityFeePerGas: intent.maxPriorityFeePerGas.toString(),
                            maxFeePerGas: intent.maxFeePerGas.toString(),
                            nonce: intent.nonce,
                        },
                    },
                },
                { autoSign: true },
            );
        } catch (error) {
            throw classifiedPayboxError(error, PayboxRequestContext.Authenticated);
        }
        return serializedTransactionFromResponse(response, credentialId);
    }

    private client(tokens: PayboxTokens, signingKey: string): PayboxSdkClient {
        return this.factory.create({ baseUrl: tokens.baseUrl, token: tokens.accessToken, signingKey });
    }
}
