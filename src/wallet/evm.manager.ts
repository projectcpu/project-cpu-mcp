import {
    createPublicClient,
    createWalletClient,
    http,
    type Address,
    type Hash,
    type Hex,
    type PrivateKeyAccount,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { createNonceManager, jsonRpc, type NonceManager } from 'viem/nonce';

import { viemChainForChainId } from './chain.utils.js';
import {
    type EvmWalletManagerOptions,
    type GasEstimateRequest,
    type ReadContractParams,
    type SignTypedDataRequest,
    type TransactionRequest,
    type TxReceipt,
    TxStatus,
    type WalletManager,
} from './types.js';
import type { ILogger } from '../logger/types.js';

export class EvmWalletManager implements WalletManager {
    private readonly logger: ILogger;
    private readonly account: PrivateKeyAccount;
    private readonly chainId: number;
    private readonly nonces: NonceManager;
    // Built once at construction — viem clients are lazy on the wire, so this makes no network call;
    // the request only happens on sendTransaction / waitForReceipt.
    private readonly walletClient;
    private readonly publicClient;

    constructor(options: EvmWalletManagerOptions) {
        this.logger = options.logger;
        this.nonces = createNonceManager({ source: jsonRpc() });
        this.account = privateKeyToAccount(options.privateKey, { nonceManager: this.nonces });
        this.chainId = options.chainId;

        const chain = viemChainForChainId(options.chainId);
        const transport = options.rpcUrl !== null ? http(options.rpcUrl) : http();
        this.walletClient = createWalletClient({ account: this.account, chain, transport });
        this.publicClient = createPublicClient({ chain, transport });
    }

    getAddress(): Address {
        return this.account.address;
    }

    getChainId(): number {
        return this.chainId;
    }

    async sendTransaction(tx: TransactionRequest): Promise<Hash> {
        this.logger.info('sending tx', { to: tx.to, value: tx.value !== null ? tx.value.toString() : null });
        try {
            const hash = await this.walletClient.sendTransaction({
                to: tx.to,
                data: tx.data,
                value: tx.value ?? undefined,
                gas: tx.gas ?? undefined,
            });
            this.logger.info('tx sent', { hash });
            return hash;
        } catch (error) {
            this.nonces.reset({ address: this.account.address, chainId: this.chainId });
            throw error;
        }
    }

    async estimateGas(tx: GasEstimateRequest): Promise<bigint> {
        return this.publicClient.estimateGas({
            account: this.account.address,
            to: tx.to,
            data: tx.data,
            value: tx.value ?? undefined,
        });
    }

    async getGasPrice(): Promise<bigint> {
        return this.publicClient.getGasPrice();
    }

    async waitForReceipt(hash: Hash): Promise<TxReceipt> {
        const receipt = await this.publicClient.waitForTransactionReceipt({ hash });
        return {
            status: receipt.status === 'success' ? TxStatus.Success : TxStatus.Reverted,
            transactionHash: receipt.transactionHash,
            blockNumber: receipt.blockNumber,
            logs: receipt.logs,
        };
    }

    async getTransactionSender(hash: Hash): Promise<Address | null> {
        const transaction = await this.publicClient.getTransaction({ hash });
        return transaction.from;
    }

    async readContract(params: ReadContractParams): Promise<unknown> {
        return this.publicClient.readContract({
            address: params.address,
            abi: params.abi,
            functionName: params.functionName,
            args: params.args,
        });
    }

    async getBalance(): Promise<bigint> {
        return this.publicClient.getBalance({ address: this.account.address });
    }

    async signMessage(message: string): Promise<Hex> {
        this.logger.debug('signing message with EVM key');
        return this.account.signMessage({ message });
    }

    async signTypedData(request: SignTypedDataRequest): Promise<Hex> {
        this.logger.debug('signing typed data with EVM key', {
            primaryType: request.primaryType,
            verifyingContract: request.domain.verifyingContract,
            chainId: request.domain.chainId,
        });
        return this.account.signTypedData(request as unknown as Parameters<PrivateKeyAccount['signTypedData']>[0]);
    }
}
