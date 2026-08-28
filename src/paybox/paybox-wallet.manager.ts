import { getAddress, type Address, type Hash, type Hex } from 'viem';

import {
    PayboxAuthInvalidError,
    PayboxInvalidOperationArtifactError,
    PayboxOperationDeniedError,
    PayboxOperationIncompleteError,
    PayboxTemporarilyUnavailableError,
} from './errors.js';
import { verifiedPayboxMessageSignature, verifiedPayboxTransaction } from './paybox-wallet.utils.js';
import type { PayboxAuthMaterial, PayboxTransactionIntent, PayboxWalletManagerOptions } from './types.js';
import { AuthenticationRequiredError } from '../api/authentication-required.error.js';
import { LAUNCH_CHAIN_ID } from '../config/constants.js';
import type {
    GasEstimateRequest,
    ReadContractParams,
    TransactionRequest,
    TxReceipt,
    WalletManager,
} from '../wallet/types.js';

export class PayboxWalletManager implements WalletManager {
    private readonly address: Address;
    private readonly options: PayboxWalletManagerOptions;
    private transactionQueue: Promise<void> = Promise.resolve();

    public constructor(options: PayboxWalletManagerOptions) {
        this.options = options;
        this.address = getAddress(options.address);
    }

    public getAddress(): Address {
        return this.address;
    }

    public getChainId(): number {
        return LAUNCH_CHAIN_ID;
    }

    public async signMessage(message: string): Promise<Hex> {
        const authority = await this.currentAuthority();
        try {
            const signature = await this.options.sdk.signMessage(
                authority.tokens,
                authority.signingKey,
                this.options.credentialId,
                message,
            );
            return await verifiedPayboxMessageSignature(message, signature as Hex, this.address);
        } catch (error) {
            this.throwSigningFailure(error);
        }
    }

    public sendTransaction(tx: TransactionRequest): Promise<Hash> {
        const operation = this.transactionQueue.then(() => this.sendAtQueueHead(tx));
        this.transactionQueue = operation.then(
            () => undefined,
            () => undefined,
        );
        return operation;
    }

    public estimateGas(tx: GasEstimateRequest): Promise<bigint> {
        return this.options.rpc.estimateGas(this.address, tx);
    }

    public getGasPrice(): Promise<bigint> {
        return this.options.rpc.getGasPrice();
    }

    public waitForReceipt(hash: Hash): Promise<TxReceipt> {
        return this.options.rpc.waitForReceipt(hash);
    }

    public readContract(params: ReadContractParams): Promise<unknown> {
        return this.options.rpc.readContract(params);
    }

    public getBalance(): Promise<bigint> {
        return this.options.rpc.getBalance(this.address);
    }

    private async sendAtQueueHead(tx: TransactionRequest): Promise<Hash> {
        const authority = await this.currentAuthority();
        const gasRequest = { to: tx.to, data: tx.data, value: tx.value };
        const [nonce, fees, gas] = await Promise.all([
            this.options.rpc.getPendingNonce(this.address),
            this.options.rpc.estimateEip1559Fees(),
            tx.gas === null ? this.options.rpc.estimateGas(this.address, gasRequest) : Promise.resolve(tx.gas),
        ]);
        const intent: PayboxTransactionIntent = {
            to: tx.to,
            data: tx.data,
            value: tx.value ?? 0n,
            chainId: LAUNCH_CHAIN_ID,
            gas,
            maxPriorityFeePerGas: fees.maxPriorityFeePerGas,
            maxFeePerGas: fees.maxFeePerGas,
            nonce,
        };
        this.options.logger.info('requesting Paybox transaction signature', {
            to: intent.to,
            value: intent.value.toString(),
            nonce: intent.nonce,
        });
        let verified: Hex;
        try {
            const serializedTransaction = await this.options.sdk.signTransaction(
                authority.tokens,
                authority.signingKey,
                this.options.credentialId,
                intent,
            );
            verified = await verifiedPayboxTransaction(intent, serializedTransaction, this.address);
        } catch (error) {
            this.throwSigningFailure(error);
        }
        const hash = await this.options.rpc.sendRawTransaction(verified);
        this.options.logger.info('Paybox transaction sent', { hash });
        return hash;
    }

    private throwSigningFailure(error: unknown): never {
        if (error instanceof PayboxAuthInvalidError) {
            this.options.logger.warn('Paybox signing authority invalidated', { ...error.diagnostic });
            this.options.authority.invalidate();
            throw new AuthenticationRequiredError();
        }
        if (
            error instanceof PayboxOperationDeniedError ||
            error instanceof PayboxTemporarilyUnavailableError ||
            error instanceof PayboxOperationIncompleteError ||
            error instanceof PayboxInvalidOperationArtifactError
        ) {
            this.options.logger.warn('Paybox signing request failed', { ...error.diagnostic });
        }
        throw error;
    }

    private async currentAuthority(): Promise<PayboxAuthMaterial> {
        try {
            return await this.options.authority.current();
        } catch (error) {
            this.throwSigningFailure(error);
        }
    }
}
