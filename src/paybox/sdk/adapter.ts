import { defaultPayboxSdkClientFactory, defaultPayboxTokenRefresher } from './factory.js';
import { payboxSdkFailureLogMeta } from './logging.utils.js';
import { autonomousEvmGrants, classifiedPayboxError } from './utils.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type { WalletManager } from '../../wallet/types.js';
import {
    PayboxInvalidOperationArtifactError,
    PayboxOperationDeniedError,
    PayboxOperationIncompleteError,
} from '../errors.js';
import { PayboxRequestContext, PayboxSdkOperation, PayboxSdkStage, payboxTokensSchema } from '../types.js';
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
} from '../types.js';
import { PayboxWalletManager } from '../wallet/manager.js';
import { PayboxRpcClient } from '../wallet/rpc.client.js';

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
            throw this.classifiedFailure(
                PayboxSdkOperation.RefreshTokens,
                PayboxSdkStage.RefreshTokens,
                PayboxRequestContext.Refresh,
                error,
            );
        }
    }

    public async listEligibleAutonomousEvmGrants(
        tokens: PayboxTokens,
        signingKey: string,
    ): Promise<EligiblePayboxGrantList> {
        let response;
        try {
            response = await this.client(tokens, signingKey).listCredentials();
        } catch (error) {
            throw this.classifiedFailure(
                PayboxSdkOperation.ListEligibleAutonomousEvmGrants,
                PayboxSdkStage.ListCredentials,
                PayboxRequestContext.Authenticated,
                error,
            );
        }
        try {
            return autonomousEvmGrants(response, tokens.baseUrl);
        } catch (error) {
            throw this.classifiedFailure(
                PayboxSdkOperation.ListEligibleAutonomousEvmGrants,
                PayboxSdkStage.NormalizeCredentials,
                PayboxRequestContext.Authenticated,
                error,
            );
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
            throw this.classifiedFailure(
                PayboxSdkOperation.SignMessage,
                PayboxSdkStage.RequestWalletSign,
                PayboxRequestContext.Authenticated,
                error,
            );
        }
        if (response.status === 'denied') throw new PayboxOperationDeniedError();
        if (response.status !== 'success' || response.output === null) {
            throw new PayboxOperationIncompleteError();
        }
        if (response.output.output_type !== 'signature' || response.output.credential_id !== credentialId) {
            throw new PayboxInvalidOperationArtifactError({
                outputType: response.output.output_type,
                credentialId: response.output.credential_id,
            });
        }
        return (response.output.value as { signature: string }).signature;
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
            throw this.classifiedFailure(
                PayboxSdkOperation.SignTransaction,
                PayboxSdkStage.RequestWalletSign,
                PayboxRequestContext.Authenticated,
                error,
            );
        }
        if (response.status === 'denied') throw new PayboxOperationDeniedError();
        if (response.status !== 'success' || response.output === null) {
            throw new PayboxOperationIncompleteError();
        }
        if (response.output.output_type !== 'signature' || response.output.credential_id !== credentialId) {
            throw new PayboxInvalidOperationArtifactError({
                outputType: response.output.output_type,
                credentialId: response.output.credential_id,
            });
        }
        return (response.output.value as { serializedTransaction: `0x${string}` }).serializedTransaction;
    }

    private client(tokens: PayboxTokens, signingKey: string): PayboxSdkClient {
        return this.factory.create({ baseUrl: tokens.baseUrl, token: tokens.accessToken, signingKey });
    }

    private classifiedFailure(
        operation: PayboxSdkOperation,
        stage: PayboxSdkStage,
        requestContext: PayboxRequestContext,
        error: unknown,
    ): Error {
        const classifiedError = classifiedPayboxError(error, requestContext);
        this.walletOptions.logger.warn(
            'Paybox SDK operation failed',
            payboxSdkFailureLogMeta(operation, stage, requestContext, error, classifiedError),
        );
        return classifiedError;
    }
}
