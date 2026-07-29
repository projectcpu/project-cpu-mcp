import { isAddress, parseEther, parseEventLogs, type Address, type Log } from 'viem';

import type {
    AppConfig,
    IAppConfig,
    ICellClient,
    WithdrawInput,
    WithdrawResult,
    WithdrawServiceOptions,
} from './types.js';
import { CELL_ABI } from '../contracts/cell.abi.js';
import type { ILogger } from '../logger/types.js';
import type { Cell, RevealCellReader } from '../map/types.js';
import type { IContractClient, WalletManager, WalletProvider } from '../wallet/types.js';

export class WithdrawService {
    private readonly wallet: WalletProvider;
    private readonly appConfig: IAppConfig;
    private readonly cellClient: ICellClient;
    private readonly contracts: IContractClient;
    private readonly mapReader: RevealCellReader;
    private readonly logger: ILogger;

    constructor(options: WithdrawServiceOptions) {
        this.wallet = options.wallet;
        this.appConfig = options.appConfig;
        this.cellClient = options.cellClient;
        this.contracts = options.contracts;
        this.mapReader = options.mapReader;
        this.logger = options.logger;
    }

    async withdraw(input: WithdrawInput): Promise<WithdrawResult> {
        const config = await this.appConfig.load();
        const wallet = this.wallet.get();
        this.assertChain(config, wallet);

        const cell = this.requireCell(config);
        const tokenId = BigInt(input.tokenId);
        const requestedUnits = BigInt(input.amount);
        const amount = parseEther(input.amount);

        const state = await this.mapReader.readRevealCell(input.tokenId);
        this.assertOwner(input.tokenId, state, wallet.getAddress());

        this.logger.info('withdrawing wCPU', {
            tokenId: input.tokenId,
            amount: input.amount,
            network: config.network,
        });
        const txHash = await this.cellClient.withdrawCpu({ cell, tokenId, amount });
        const confirmed = await this.contracts.confirm(txHash, 'Withdraw transaction');
        const executedUnits = this.decodeWithdrawn(confirmed.logs, cell) ?? requestedUnits;

        this.logger.info('withdraw confirmed', {
            tokenId: input.tokenId,
            requested: requestedUnits.toString(),
            executed: executedUnits.toString(),
            txHash: confirmed.txHash,
            block: confirmed.blockNumber,
        });
        return {
            tokenId: input.tokenId,
            requested: requestedUnits.toString(),
            executed: executedUnits.toString(),
            partial: executedUnits < requestedUnits,
            txHash: confirmed.txHash,
            status: confirmed.status,
            blockNumber: confirmed.blockNumber,
        };
    }

    private decodeWithdrawn(logs: Array<Log>, cell: Address): bigint | null {
        const events = parseEventLogs({ abi: CELL_ABI, eventName: 'CpuWithdrawn', logs });
        const event = events.find((e) => e.address.toLowerCase() === cell.toLowerCase());
        return event === undefined ? null : event.args.amount;
    }

    private assertChain(config: AppConfig, wallet: WalletManager): void {
        if (config.chainId !== wallet.getChainId()) {
            throw new Error(
                `Chain mismatch: the chain config is chainId ${config.chainId} but the wallet is on ${wallet.getChainId()}. Check NETWORK.`,
            );
        }
    }

    private requireCell(config: AppConfig): Address {
        const cell = config.contracts.cell;
        if (!isAddress(cell, { strict: false })) {
            throw new Error(`Cell contract is not configured for network ${config.network}; cannot withdraw.`);
        }
        return cell;
    }

    private assertOwner(tokenId: string, state: Cell | null, address: string): void {
        if (state !== null && state.owner.toLowerCase() !== address.toLowerCase()) {
            throw new Error(`You do not own cell ${tokenId} (owner ${state.owner}); only the owner can withdraw.`);
        }
    }
}
