import { parseEther, parseEventLogs, type Address, type Log } from 'viem';

import { preparePaidAction } from './paid-action.js';
import { AppContract } from './paid-action.types.js';
import type { IAppConfig, ICellClient, WithdrawInput, WithdrawResult, WithdrawServiceOptions } from './types.js';
import { CELL_ABI } from '../contracts/cell.abi.js';
import type { ILogger } from '../logger/types.js';
import type { Cell, RevealCellReader } from '../map/types.js';
import type { IContractClient, WalletProvider } from '../wallet/types.js';

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
        const action = await preparePaidAction({ appConfig: this.appConfig, wallet: this.wallet });
        const { config, wallet } = action;
        const cell = action.requireContract(AppContract.Cell, 'cannot withdraw');
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

    private assertOwner(tokenId: string, state: Cell | null, address: string): void {
        if (state !== null && state.owner.toLowerCase() !== address.toLowerCase()) {
            throw new Error(`You do not own cell ${tokenId} (owner ${state.owner}); only the owner can withdraw.`);
        }
    }
}
