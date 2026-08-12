import { encodeFunctionData, type Address, type Hash } from 'viem';

import { withRevealInFlightPhrase, withRevealRequestPhrase } from './reveal-revert.utils.js';
import type {
    CellClientOptions,
    CellViewResult,
    ClaimParams,
    DemolishParams,
    ICellClient,
    PlaceParams,
    RequestRevealParams,
    RevealQuote,
    StartCraftParams,
    StartMiningParams,
    WithdrawCpuParams,
} from './types.js';
import { CELL_ABI } from '../contracts/cell.abi.js';
import type { ILogger } from '../logger/types.js';
import { bufferedGasLimit } from '../wallet/gas.utils.js';
import type { IContractClient } from '../wallet/types.js';

export class CellClient implements ICellClient {
    private readonly contracts: IContractClient;
    private readonly logger: ILogger;

    constructor(options: CellClientOptions) {
        this.contracts = options.contracts;
        this.logger = options.logger;
    }

    async readCellView(cell: Address, tokenId: bigint): Promise<CellViewResult> {
        return this.contracts.read<CellViewResult>({
            address: cell,
            abi: CELL_ABI,
            functionName: 'getCell',
            args: [tokenId],
        });
    }

    async quoteReveal(cell: Address): Promise<RevealQuote> {
        const [ethContributionWei, randomnessFeeWei, totalRequiredWei, cpuBurnWei] = await this.contracts.read<
            readonly [bigint, bigint, bigint, bigint]
        >({
            address: cell,
            abi: CELL_ABI,
            functionName: 'quoteReveal',
            args: [],
        });
        this.logger.info('quoted the reveal', {
            cell,
            totalRequiredWei: totalRequiredWei.toString(),
            cpuBurnWei: cpuBurnWei.toString(),
        });
        return { ethContributionWei, randomnessFeeWei, totalRequiredWei, cpuBurnWei };
    }

    async requestReveal(params: RequestRevealParams): Promise<Hash> {
        const data = encodeFunctionData({
            abi: CELL_ABI,
            functionName: 'requestReveal',
            args: [params.tokenId],
        });
        this.logger.info('submitting reveal request', {
            cell: params.cell,
            tokenId: params.tokenId.toString(),
            valueWei: params.value.toString(),
        });
        const call = { to: params.cell, data, value: params.value };
        try {
            const gas = bufferedGasLimit(await this.contracts.estimateGas(call));
            return await this.contracts.send({ ...call, gas }, CELL_ABI);
        } catch (error) {
            throw withRevealRequestPhrase(error, params.tokenId.toString());
        }
    }

    async place(params: PlaceParams): Promise<Hash> {
        const data = encodeFunctionData({
            abi: CELL_ABI,
            functionName: 'place',
            args: [params.tokenId, params.buildingType],
        });
        this.logger.info('submitting place', {
            cell: params.cell,
            tokenId: params.tokenId.toString(),
            buildingType: params.buildingType,
        });
        try {
            return await this.contracts.send({ to: params.cell, data, value: null, gas: null }, CELL_ABI);
        } catch (error) {
            throw withRevealInFlightPhrase(error, params.tokenId.toString());
        }
    }

    async demolish(params: DemolishParams): Promise<Hash> {
        const data = encodeFunctionData({
            abi: CELL_ABI,
            functionName: 'demolish',
            args: [params.tokenId],
        });
        this.logger.info('submitting demolish', { cell: params.cell, tokenId: params.tokenId.toString() });
        return this.contracts.send({ to: params.cell, data, value: null, gas: null }, CELL_ABI);
    }

    async startMining(params: StartMiningParams): Promise<Hash> {
        const data = encodeFunctionData({
            abi: CELL_ABI,
            functionName: 'startMining',
            args: [params.tokenId, params.target, params.batches],
        });
        this.logger.info('submitting startMining', {
            cell: params.cell,
            tokenId: params.tokenId.toString(),
            target: params.target,
            batches: params.batches,
        });
        return this.contracts.send({ to: params.cell, data, value: null, gas: null }, CELL_ABI);
    }

    async startCraft(params: StartCraftParams): Promise<Hash> {
        const data = encodeFunctionData({
            abi: CELL_ABI,
            functionName: 'startCraft',
            args: [params.tokenId, params.recipeId, params.batches],
        });
        this.logger.info('submitting startCraft', {
            cell: params.cell,
            tokenId: params.tokenId.toString(),
            recipeId: params.recipeId.toString(),
            batches: params.batches,
        });
        return this.contracts.send({ to: params.cell, data, value: null, gas: null }, CELL_ABI);
    }

    async claim(params: ClaimParams): Promise<Hash> {
        const data = encodeFunctionData({
            abi: CELL_ABI,
            functionName: 'claim',
            args: [params.tokenId],
        });
        this.logger.info('submitting claim', { cell: params.cell, tokenId: params.tokenId.toString() });
        return this.contracts.send({ to: params.cell, data, value: null, gas: null }, CELL_ABI);
    }

    async withdrawCpu(params: WithdrawCpuParams): Promise<Hash> {
        const data = encodeFunctionData({
            abi: CELL_ABI,
            functionName: 'withdrawCpu',
            args: [params.tokenId, params.amount],
        });
        this.logger.info('submitting withdrawCpu', {
            cell: params.cell,
            tokenId: params.tokenId.toString(),
            amount: params.amount.toString(),
        });
        return this.contracts.send({ to: params.cell, data, value: null, gas: null }, CELL_ABI);
    }
}
