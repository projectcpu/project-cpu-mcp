import { createSessionClient, type SessionConfig } from '@abstract-foundation/agw-client/sessions';
import { createPublicClient, http, type Address, type Hash, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { abstractTestnet } from 'viem/chains';

import {
    type AgwWalletManagerOptions,
    type GasEstimateRequest,
    type ReadContractParams,
    type TransactionRequest,
    type TxReceipt,
    TxStatus,
    type WalletManager,
} from './types.js';
import type { ILogger } from '../logger/types.js';

type SessionClient = ReturnType<typeof createSessionClient>;

export class AgwWalletManager implements WalletManager {
    private readonly logger: ILogger;
    private readonly sessionClient: SessionClient;
    private readonly accountAddress: Address;
    private readonly rpcUrl: string | null;

    constructor(options: AgwWalletManagerOptions) {
        this.logger = options.logger;
        this.accountAddress = options.sessionConfig.accountAddress as Address;
        this.rpcUrl = options.rpcUrl;

        const signer = privateKeyToAccount(options.sessionPrivateKey);
        // The API returns the on-chain SessionConfig shape inside `policies`.
        // Cast through unknown since our persisted schema stores it as `z.unknown()`.
        const session = options.sessionConfig.policies as unknown as SessionConfig;

        this.sessionClient = createSessionClient({
            account: this.accountAddress,
            chain: abstractTestnet,
            signer,
            session,
            transport: options.rpcUrl !== null ? http(options.rpcUrl) : http(),
        });
    }

    getAddress(): Address {
        return this.accountAddress;
    }

    getChainId(): number {
        return abstractTestnet.id;
    }

    async sendTransaction(tx: TransactionRequest): Promise<Hash> {
        this.logger.info('sending tx via session key', {
            to: tx.to,
            value: tx.value !== null ? tx.value.toString() : null,
        });

        const hash = await this.sessionClient.sendTransaction({
            account: this.sessionClient.account,
            chain: abstractTestnet,
            to: tx.to,
            value: tx.value ?? undefined,
            data: tx.data,
            gas: tx.gas ?? undefined,
        });

        this.logger.info('tx sent', { hash });
        return hash;
    }

    async estimateGas(tx: GasEstimateRequest): Promise<bigint> {
        return this.publicClient().estimateGas({
            account: this.accountAddress,
            to: tx.to,
            data: tx.data,
            value: tx.value ?? undefined,
        });
    }

    async getGasPrice(): Promise<bigint> {
        return this.publicClient().getGasPrice();
    }

    async waitForReceipt(hash: Hash): Promise<TxReceipt> {
        const receipt = await this.publicClient().waitForTransactionReceipt({ hash });
        return {
            status: receipt.status === 'success' ? TxStatus.Success : TxStatus.Reverted,
            transactionHash: receipt.transactionHash,
            blockNumber: receipt.blockNumber,
            logs: receipt.logs,
        };
    }

    async readContract(params: ReadContractParams): Promise<unknown> {
        return this.publicClient().readContract({
            address: params.address,
            abi: params.abi,
            functionName: params.functionName,
            args: params.args,
        });
    }

    async getBalance(): Promise<bigint> {
        return this.publicClient().getBalance({ address: this.accountAddress });
    }

    private publicClient() {
        return createPublicClient({
            chain: abstractTestnet,
            transport: this.rpcUrl !== null ? http(this.rpcUrl) : http(),
        });
    }

    async signMessage(_message: string): Promise<Hex> {
        throw new Error('AgwWalletManager.signMessage: not implemented');
    }
}
