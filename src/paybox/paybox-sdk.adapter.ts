import { PayboxRpcClient } from './paybox-rpc.client.js';
import { defaultPayboxSdkClientFactory } from './paybox-sdk.factory.js';
import { PayboxWalletManager } from './paybox-wallet.manager.js';
import { autonomousEvmGrants, serializedTransactionFromResponse, signatureFromResponse } from './sdk.utils.js';
import type {
    EligiblePayboxGrantList,
    IPayboxSdkAdapter,
    PayboxSdkClient,
    PayboxSdkClientFactory,
    PayboxSdkWalletOptions,
    PayboxTransactionIntent,
    PayboxTokens,
} from './types.js';
import { NoopLogger } from '../logger/noop.logger.js';
import type { WalletManager } from '../wallet/types.js';

export class PayboxSdkAdapter implements IPayboxSdkAdapter {
    public constructor(
        private readonly factory: PayboxSdkClientFactory = defaultPayboxSdkClientFactory,
        private readonly walletOptions: PayboxSdkWalletOptions = { rpcUrl: null, logger: new NoopLogger() },
    ) {}

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
    ): WalletManager {
        return new PayboxWalletManager({
            sdk: this,
            tokens,
            signingKey,
            credentialId,
            address,
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
        const response = await this.client(tokens, signingKey).requestWalletSign(
            { credentialId, intent: { op: 'message', message } },
            { autoSign: true },
        );
        return signatureFromResponse(response, credentialId);
    }

    public async signTransaction(
        tokens: PayboxTokens,
        signingKey: string,
        credentialId: string,
        intent: PayboxTransactionIntent,
    ): Promise<`0x${string}`> {
        const response = await this.client(tokens, signingKey).requestWalletSign(
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
        return serializedTransactionFromResponse(response, credentialId);
    }

    private client(tokens: PayboxTokens, signingKey: string): PayboxSdkClient {
        return this.factory.create({ baseUrl: tokens.baseUrl, token: tokens.accessToken, signingKey });
    }
}
