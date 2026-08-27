import { createPublicClient, http, type Address, type Hash, type Hex } from 'viem';

import type { IPayboxRpcClient, PayboxEip1559Fees, PayboxRpcClientOptions } from './types.js';
import { LAUNCH_CHAIN_ID } from '../config/constants.js';
import { viemChainForChainId } from '../wallet/chain.utils.js';
import { TxStatus, type GasEstimateRequest, type ReadContractParams, type TxReceipt } from '../wallet/types.js';

export class PayboxRpcClient implements IPayboxRpcClient {
    private readonly client;

    public constructor(options: PayboxRpcClientOptions) {
        const transport = options.rpcUrl === null ? http() : http(options.rpcUrl);
        this.client = createPublicClient({ chain: viemChainForChainId(LAUNCH_CHAIN_ID), transport });
    }

    public getPendingNonce(address: Address): Promise<number> {
        return this.client.getTransactionCount({ address, blockTag: 'pending' });
    }

    public async estimateEip1559Fees(): Promise<PayboxEip1559Fees> {
        const fees = await this.client.estimateFeesPerGas({ type: 'eip1559' });
        return { maxPriorityFeePerGas: fees.maxPriorityFeePerGas, maxFeePerGas: fees.maxFeePerGas };
    }

    public estimateGas(address: Address, tx: GasEstimateRequest): Promise<bigint> {
        return this.client.estimateGas({
            account: address,
            to: tx.to,
            data: tx.data,
            value: tx.value ?? undefined,
        });
    }

    public sendRawTransaction(serializedTransaction: Hex): Promise<Hash> {
        return this.client.sendRawTransaction({ serializedTransaction });
    }

    public getGasPrice(): Promise<bigint> {
        return this.client.getGasPrice();
    }

    public async waitForReceipt(hash: Hash): Promise<TxReceipt> {
        const receipt = await this.client.waitForTransactionReceipt({ hash });
        return {
            status: receipt.status === 'success' ? TxStatus.Success : TxStatus.Reverted,
            transactionHash: receipt.transactionHash,
            blockNumber: receipt.blockNumber,
            logs: receipt.logs,
        };
    }

    public readContract(params: ReadContractParams): Promise<unknown> {
        return this.client.readContract({
            address: params.address,
            abi: params.abi,
            functionName: params.functionName,
            args: params.args,
        });
    }

    public getBalance(address: Address): Promise<bigint> {
        return this.client.getBalance({ address });
    }
}
