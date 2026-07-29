import type { Abi, Address, Hash, Hex, Log } from 'viem';

import type { EnvConfig } from '../config/types.js';
import type { ILogger } from '../logger/types.js';
import type { SessionManager } from '../session/manager.js';
import type { AgwSessionConfig } from '../session/types.js';
import type { RetryOptions } from '../utils/retry.utils.js';

export interface GasEstimateRequest {
    to: Address;
    data: Hex;
    value: bigint | null;
}

export interface TransactionRequest extends GasEstimateRequest {
    gas: bigint | null;
}

export enum TxStatus {
    Success = 'success',
    Reverted = 'reverted',
}

export interface TxReceipt {
    status: TxStatus;
    transactionHash: Hash;
    blockNumber: bigint;
    logs: Array<Log>;
}

export interface DecodedRevert {
    name: string;
    args: ReadonlyArray<unknown>;
}

export interface ReadContractParams {
    address: Address;
    abi: Abi;
    functionName: string;
    args: ReadonlyArray<unknown>;
}

export interface WalletManager {
    getAddress(): Address;
    getChainId(): number;
    sendTransaction(tx: TransactionRequest): Promise<Hash>;
    estimateGas(tx: GasEstimateRequest): Promise<bigint>;
    getGasPrice(): Promise<bigint>;
    waitForReceipt(hash: Hash): Promise<TxReceipt>;
    readContract(params: ReadContractParams): Promise<unknown>;
    /** Native gas balance of the wallet address, in wei. */
    getBalance(): Promise<bigint>;
    signMessage(message: string): Promise<Hex>;
}

export interface WalletProvider {
    get(): WalletManager;
    isReady(): boolean;
}

export interface ConfirmedTx {
    txHash: Hash;
    status: TxStatus;
    blockNumber: string;
    logs: Array<Log>;
}

export interface IContractClient {
    read<T>(params: ReadContractParams): Promise<T>;
    estimateGas(tx: GasEstimateRequest): Promise<bigint>;
    /** `errorAbi` decodes custom-error reverts into readable names; pass null when no ABI applies. */
    send(tx: TransactionRequest, errorAbi: Abi | null): Promise<Hash>;
    confirm(hash: Hash, revertLabel: string): Promise<ConfirmedTx>;
}

export interface ContractClientOptions {
    wallet: WalletProvider;
    logger: ILogger;
    retry: Partial<RetryOptions> | null;
}

export interface EvmWalletManagerOptions {
    privateKey: Hex;
    chainId: number;
    rpcUrl: string | null;
    logger: ILogger;
}

export interface AgwWalletManagerOptions {
    sessionPrivateKey: Hex;
    sessionConfig: AgwSessionConfig;
    rpcUrl: string | null;
    logger: ILogger;
}

export interface CreateWalletProviderInput {
    config: EnvConfig;
    session: SessionManager;
    logger: ILogger;
}
