import type { Abi, Hash } from 'viem';

import { describeRevert } from './revert.utils.js';
import {
    TxStatus,
    type ConfirmedTx,
    type ContractClientOptions,
    type GasEstimateRequest,
    type IContractClient,
    type ReadContractParams,
    type TransactionRequest,
    type WalletProvider,
} from './types.js';
import type { ILogger } from '../logger/types.js';
import { withRetry, type RetryOptions } from '../utils/retry.utils.js';

export class ContractClient implements IContractClient {
    private readonly wallet: WalletProvider;
    private readonly logger: ILogger;
    private readonly retry: Partial<RetryOptions>;

    constructor(options: ContractClientOptions) {
        this.wallet = options.wallet;
        this.logger = options.logger;
        this.retry = options.retry ?? {};
    }

    async read<T>(params: ReadContractParams): Promise<T> {
        return withRetry(async () => (await this.wallet.get().readContract(params)) as T, {
            ...this.retry,
            logger: this.logger,
            label: `read ${params.functionName}`,
        });
    }

    async estimateGas(tx: GasEstimateRequest): Promise<bigint> {
        return withRetry(() => this.wallet.get().estimateGas(tx), {
            ...this.retry,
            logger: this.logger,
            label: 'estimateGas',
        });
    }

    async send(tx: TransactionRequest, errorAbi: Abi | null): Promise<Hash> {
        try {
            return await this.wallet.get().sendTransaction(tx);
        } catch (error) {
            const revert = errorAbi !== null ? describeRevert(error, errorAbi) : null;
            if (revert === null) {
                throw error;
            }
            this.logger.error('transaction reverted', { to: tx.to, revert });
            throw new Error(`Execution reverted: ${revert}`, { cause: error });
        }
    }

    async confirm(hash: Hash, revertLabel: string): Promise<ConfirmedTx> {
        const receipt = await withRetry(() => this.wallet.get().waitForReceipt(hash), {
            ...this.retry,
            logger: this.logger,
            label: 'waitForReceipt',
        });
        if (receipt.status === TxStatus.Reverted) {
            throw new Error(`${revertLabel} reverted on-chain (tx ${hash}).`);
        }
        return {
            txHash: receipt.transactionHash,
            status: receipt.status,
            blockNumber: receipt.blockNumber.toString(),
            logs: receipt.logs,
        };
    }
}
