import { parseEther, parseEventLogs, type Address, type Log } from 'viem';

import { recipeNameFromUint64, recipeNameToUint64 } from './cell.utils.js';
import { effectiveCraftInputs } from './craft-quote.utils.js';
import { ModeSwitchCoordinator } from './mode-switch.js';
import { ModeOperation } from './mode-switch.types.js';
import { preparePaidAction } from './paid-action.js';
import { AppContract } from './paid-action.types.js';
import {
    type CatalogBuildingView,
    type CraftClaimResult,
    type CraftInput,
    type CraftOpexCharge,
    type CraftOutput,
    type CraftServiceOptions,
    type CraftStartResult,
    type CraftStatusResult,
    type IAppConfig,
    type ICellClient,
} from './types.js';
import { assertWarehouseHas } from './warehouse.utils.js';
import type { CraftRecipeId } from '../api/types.js';
import { CELL_ABI } from '../contracts/cell.abi.js';
import type { ILogger } from '../logger/types.js';
import { projectCellProcess } from '../map/process-projection.utils.js';
import { toProjectionConfig } from '../map/reader.utils.js';
import { CellProcessKind, type RevealCellReader } from '../map/types.js';
import { cpuFromWei } from '../utils/format.utils.js';
import type { IContractClient, WalletProvider } from '../wallet/types.js';

export class CraftService {
    private readonly wallet: WalletProvider;
    private readonly appConfig: IAppConfig;
    private readonly cellClient: ICellClient;
    private readonly contracts: IContractClient;
    private readonly mapReader: RevealCellReader;
    private readonly logger: ILogger;
    private readonly modeSwitch: ModeSwitchCoordinator;

    constructor(options: CraftServiceOptions) {
        this.wallet = options.wallet;
        this.appConfig = options.appConfig;
        this.cellClient = options.cellClient;
        this.contracts = options.contracts;
        this.mapReader = options.mapReader;
        this.logger = options.logger;
        this.modeSwitch = new ModeSwitchCoordinator({
            allowance: options.allowance,
            cellClient: options.cellClient,
            logger: options.logger,
        });
    }

    async craft(input: CraftInput): Promise<CraftStartResult> {
        const action = await preparePaidAction({ appConfig: this.appConfig, wallet: this.wallet });
        const { config } = action;
        const cell = action.requireContract(AppContract.Cell, 'cannot craft');
        const recipe = config.recipes.find((r) => r.id === input.recipeId);
        if (recipe === undefined) {
            throw new Error(`Recipe ${input.recipeId} is not available on network ${config.network}.`);
        }

        // Paid action — resolve the current building before trusting either its recipe set or its input effects.
        await this.mapReader.refresh();
        const state = await this.mapReader.readRevealCell(input.tokenId);
        const tokenId = BigInt(input.tokenId);
        const targetRecipe = recipeNameToUint64(input.recipeId);
        const mapView = config.buildings.find((b) => b.type === state?.building?.type) ?? null;
        const prepared = await this.modeSwitch.prepare({
            action,
            cell,
            tokenId,
            operation: ModeOperation.Craft,
            target: targetRecipe,
            mapBuilding: mapView,
            mapMode:
                state?.building?.modeRecipeId === null || state?.building?.modeRecipeId === undefined
                    ? null
                    : recipeNameToUint64(state.building.modeRecipeId as CraftRecipeId),
            paymentPurpose: 'cannot pay for craft',
            quote: (building) => {
                if (building === null) {
                    throw new Error(
                        `Cannot determine the current building for cell ${input.tokenId}; cannot quote craft inputs.`,
                    );
                }
                if (!building.recipes.includes(input.recipeId)) {
                    throw new Error(`Building ${building.type} does not support recipe ${input.recipeId}.`);
                }
                const required = effectiveCraftInputs(recipe, building, input.batches);
                assertWarehouseHas(config.resources, state, required, input.tokenId, 'craft');
                const recipeCostWei = parseEther(recipe.costCpu) * BigInt(input.batches);
                const opex = this.opexOf(building, input.recipeId, input.batches);
                return { baseCostWei: recipeCostWei + opex.wei, data: { recipeCostWei, opex } };
            },
        });
        const { recipeCostWei, opex } = prepared.data;
        const expectedBaseWei = prepared.charge.baseCostWei;

        this.logger.info('starting craft', {
            tokenId: input.tokenId,
            recipeId: input.recipeId,
            batches: input.batches,
            costCpu: cpuFromWei(recipeCostWei.toString()),
            opexCpu: opex.charge.costCpu,
            opexServed: opex.charge.served,
            switchCost: prepared.charge.cost,
            switchCostExact: prepared.charge.exact,
        });
        const txHash = await this.cellClient.startCraft({
            cell,
            tokenId,
            recipeId: targetRecipe,
            batches: input.batches,
        });
        const confirmed = await this.contracts.confirm(txHash, 'Craft transaction');

        return {
            tokenId: input.tokenId,
            recipeId: input.recipeId,
            batches: input.batches,
            costCpu: cpuFromWei(recipeCostWei.toString()),
            opex: opex.charge,
            totalCpu: cpuFromWei(expectedBaseWei.toString()),
            modeSwitch: this.modeSwitch.reconcile({ prepared: prepared.charge, logs: confirmed.logs }),
            approveTxHash: prepared.charge.approveTxHash,
            txHash: confirmed.txHash,
            status: confirmed.status,
            blockNumber: confirmed.blockNumber,
        };
    }

    private opexOf(
        view: CatalogBuildingView | null,
        recipeId: CraftRecipeId,
        batches: number,
    ): { wei: bigint; charge: CraftOpexCharge } {
        const perBatch = view?.recipeOpexCpu?.[recipeId] ?? null;
        if (perBatch === null) {
            return { wei: 0n, charge: { served: false, costCpu: '0' } };
        }
        const wei = parseEther(perBatch) * BigInt(batches);
        return { wei, charge: { served: true, costCpu: cpuFromWei(wei.toString()) } };
    }

    async claim(tokenId: string): Promise<CraftClaimResult> {
        const action = await preparePaidAction({ appConfig: this.appConfig, wallet: this.wallet });
        const cell = action.requireContract(AppContract.Cell, 'cannot craft');
        this.logger.info('claiming craft outputs', { tokenId });
        const txHash = await this.cellClient.claim({ cell, tokenId: BigInt(tokenId) });
        const confirmed = await this.contracts.confirm(txHash, 'Craft claim');
        const claimed = this.decodeClaimed(confirmed.logs, cell);

        return {
            tokenId,
            recipeId: claimed !== null ? recipeNameFromUint64(claimed.recipeId) : null,
            batches: claimed?.batches ?? 0,
            claimedBatches: claimed?.claimedBatches ?? null,
            outputs: claimed?.outputs ?? [],
            txHash: confirmed.txHash,
            status: confirmed.status,
            blockNumber: confirmed.blockNumber,
        };
    }

    async getStatus(tokenId: string): Promise<CraftStatusResult> {
        await this.mapReader.refresh();
        const state = await this.mapReader.readRevealCell(tokenId);
        if (state === null) {
            throw new Error(`Cell ${tokenId} is not in the current map.`);
        }

        const process = state.process;
        if (process === null || process.kind !== CellProcessKind.Craft) {
            return {
                tokenId,
                active: false,
                serverTime: this.mapReader.getServerTime(),
                recipeId: null,
                batches: 0,
                claimedBatches: 0,
                completedBatches: 0,
                claimableBatches: 0,
                isFinished: false,
                startAt: null,
                durationSec: null,
                endsAtSec: null,
                nextBatchAtSec: null,
                stalled: false,
                blockedResourceIds: [],
            };
        }

        const serverTime = this.mapReader.getServerTime();
        const config = await this.appConfig.load();
        const projection = projectCellProcess(state, serverTime, toProjectionConfig(config));
        if (projection === null) {
            throw new Error(`Cell ${tokenId} lost its craft process while its status was being projected.`);
        }

        return {
            tokenId,
            active: true,
            serverTime,
            recipeId: process.recipeId,
            batches: process.batches,
            claimedBatches: process.claimedBatches,
            ...projection.progress,
            startAt: process.startAt,
            durationSec: process.durationSec,
            stalled: projection.stalled,
            blockedResourceIds: projection.stalled
                ? projection.warehouseEffects.filter((effect) => effect.blocked).map((effect) => effect.resourceId)
                : [],
        };
    }

    private decodeClaimed(
        logs: Array<Log>,
        cell: Address,
    ): { recipeId: bigint; batches: number; claimedBatches: number; outputs: Array<CraftOutput> } | null {
        const events = parseEventLogs({ abi: CELL_ABI, eventName: 'CraftClaimed', logs });
        const event = events.find((e) => e.address.toLowerCase() === cell.toLowerCase());
        if (event === undefined) {
            return null;
        }
        const outputs = event.args.outputResources.map((resourceId, i) => ({
            resourceId,
            amount: (event.args.outputAmounts[i] ?? 0n).toString(),
        }));
        return {
            recipeId: event.args.recipeId,
            batches: event.args.batches,
            claimedBatches: event.args.claimedBatches,
            outputs,
        };
    }
}
