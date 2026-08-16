import { parseEventLogs, type Address, type Log } from 'viem';

import { ModeSwitchCoordinator } from './mode-switch.js';
import { ModeOperation } from './mode-switch.types.js';
import { preparePaidAction } from './paid-action.js';
import { AppContract } from './paid-action.types.js';
import {
    type AppConfig,
    type CatalogBuildingView,
    type MiningClaimResult,
    type MiningServiceOptions,
    type MiningStatusResult,
    type StartMiningInput,
    type StartMiningResult,
    type IAppConfig,
    type ICellClient,
} from './types.js';
import { BuildingKind } from '../api/types.js';
import { CELL_ABI } from '../contracts/cell.abi.js';
import type { ILogger } from '../logger/types.js';
import { projectCellProcess } from '../map/process-projection.utils.js';
import { toProjectionConfig } from '../map/reader.utils.js';
import { CellProcessKind, type Cell, type RevealCellReader } from '../map/types.js';
import { formatUnixSeconds, resourceLabel } from '../utils/format.utils.js';
import type { IContractClient, WalletProvider } from '../wallet/types.js';

export class MiningService {
    private readonly wallet: WalletProvider;
    private readonly appConfig: IAppConfig;
    private readonly cellClient: ICellClient;
    private readonly contracts: IContractClient;
    private readonly mapReader: RevealCellReader;
    private readonly logger: ILogger;
    private readonly modeSwitch: ModeSwitchCoordinator;

    constructor(options: MiningServiceOptions) {
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

    async getStatus(tokenId: string): Promise<MiningStatusResult> {
        await this.mapReader.refresh();
        const state = await this.mapReader.readRevealCell(tokenId);
        if (state === null) {
            throw new Error(`Cell ${tokenId} is not in the current map.`);
        }

        const process = state.process;
        if (process === null || process.kind !== CellProcessKind.Mining) {
            return {
                tokenId,
                active: false,
                serverTime: this.mapReader.getServerTime(),
                targetResourceId: null,
                yieldPerCycle: null,
                durationSec: null,
                startAt: null,
                batches: 0,
                claimedBatches: 0,
                completedBatches: 0,
                claimableBatches: 0,
                isFinished: false,
                endsAtSec: null,
                nextBatchAtSec: null,
                claimable: '0',
                depositRemaining: '0',
                stalled: false,
                warehouseUsed: null,
                warehouseCap: null,
            };
        }

        const resource = state.resources.find((r) => r.resourceId === process.resource) ?? null;
        const deposit = resource?.deposit ?? '0';
        const storage = resource?.storage ?? null;
        const serverTime = this.mapReader.getServerTime();

        const config = await this.appConfig.load();
        const projection = projectCellProcess(state, serverTime, toProjectionConfig(config));
        if (projection === null) {
            throw new Error(`Cell ${tokenId} lost its mining process while its status was being projected.`);
        }

        return {
            tokenId,
            active: true,
            serverTime,
            targetResourceId: process.resource,
            yieldPerCycle: process.yieldPerCycle,
            durationSec: process.durationSec,
            startAt: process.startAt,
            batches: process.batches,
            claimedBatches: process.claimedBatches,
            ...projection.progress,
            claimable: projection.settlement.minedUnits.toString(),
            depositRemaining: deposit,
            stalled: projection.stalled,
            warehouseUsed: storage?.used ?? null,
            warehouseCap: storage?.cap ?? null,
        };
    }

    async claim(tokenId: string): Promise<MiningClaimResult> {
        const action = await preparePaidAction({ appConfig: this.appConfig, wallet: this.wallet });
        const cell = action.requireContract(AppContract.Cell, 'cannot claim');

        this.logger.info('claiming mined resources', { tokenId });
        const txHash = await this.cellClient.claim({ cell, tokenId: BigInt(tokenId) });
        const confirmed = await this.contracts.confirm(txHash, 'Mining claim');
        const mined = this.decodeMined(confirmed.logs, cell);

        return {
            tokenId,
            claimedBatches: mined?.claimedBatches ?? null,
            resourceId: mined?.resource ?? null,
            claimedAmount: (mined?.amount ?? 0n).toString(),
            txHash: confirmed.txHash,
            status: confirmed.status,
            blockNumber: confirmed.blockNumber,
        };
    }

    async startMining(input: StartMiningInput): Promise<StartMiningResult> {
        const action = await preparePaidAction({ appConfig: this.appConfig, wallet: this.wallet });
        const { config, wallet } = action;
        const cell = action.requireContract(AppContract.Cell, 'cannot start mining');

        await this.mapReader.refresh();
        const state = await this.mapReader.readRevealCell(input.tokenId);
        const { target, view } = this.resolveMiningTarget(config, state, input, wallet.getAddress());

        const tokenId = BigInt(input.tokenId);
        const prepared = await this.modeSwitch.prepare({
            action,
            cell,
            tokenId,
            operation: ModeOperation.Mining,
            target,
            mapBuilding: view,
            mapMode: state?.building?.modeResource ?? null,
            paymentPurpose: 'cannot pay to switch',
            quote: () => ({ baseCostWei: 0n, data: null }),
        });

        this.logger.info('starting mining', {
            tokenId: input.tokenId,
            target,
            batches: input.batches,
            switchCost: prepared.charge.cost,
            switchCostExact: prepared.charge.exact,
        });
        const txHash = await this.cellClient.startMining({ cell, tokenId, target, batches: input.batches });
        const confirmed = await this.contracts.confirm(txHash, 'Start mining');
        const started = this.decodeStarted(confirmed.logs, cell);

        return {
            tokenId: input.tokenId,
            targetResourceId: target,
            yieldPerCycle: started?.yieldPerCycle ?? null,
            batches: started?.batches ?? null,
            durationSec: started?.durationSec ?? null,
            modeSwitch: this.modeSwitch.reconcile({ prepared: prepared.charge, logs: confirmed.logs }),
            approveTxHash: prepared.charge.approveTxHash,
            txHash: confirmed.txHash,
            status: confirmed.status,
            blockNumber: confirmed.blockNumber,
        };
    }

    private resolveMiningTarget(
        config: AppConfig,
        state: Cell | null,
        input: StartMiningInput,
        address: string,
    ): { target: number; view: CatalogBuildingView } {
        if (state === null) {
            throw new Error(`Cell ${input.tokenId} is not in the current map; reveal it or wait for the map to sync.`);
        }
        if (state.owner.toLowerCase() !== address.toLowerCase()) {
            throw new Error(`You do not own cell ${input.tokenId} (owner ${state.owner}); only the owner can mine.`);
        }
        if (state.building === null) {
            throw new Error(`Cell ${input.tokenId} has no building; build an extractor first, then start mining.`);
        }
        const view = config.buildings.find((b) => b.type === state.building?.type) ?? null;
        if (view === null || view.kind !== BuildingKind.Extractor) {
            const name = view?.name ?? state.building.type;
            throw new Error(
                `The ${name} on cell ${input.tokenId} is not an extractor and cannot mine — crafters run cpu_craft.`,
            );
        }
        const buildFinishAt = state.building.buildFinishAt;
        if (buildFinishAt !== null && state.ready === false) {
            throw new Error(
                `The ${view.name} on cell ${input.tokenId} is still under construction (ready ` +
                    `${formatUnixSeconds(buildFinishAt)}); start mining once it finishes.`,
            );
        }
        if (state.process !== null) {
            throw new Error(
                `Cell ${input.tokenId} has an active ${state.process.kind} process; ` +
                    `claim or finish it before starting (or switching) mining.`,
            );
        }

        const target = this.pickTarget(view, input.targetResourceId, config);
        const deposit = state.resources.find((r) => r.resourceId === target)?.deposit ?? '0';
        if (BigInt(deposit) === 0n) {
            throw new Error(
                `Cell ${input.tokenId} has no ${resourceLabel(config.resources, target)} deposit to mine ` +
                    `(it may be depleted or was never revealed here).`,
            );
        }
        return { target, view };
    }

    private pickTarget(view: CatalogBuildingView, requested: number | null, config: AppConfig): number {
        const minable = view.minableResources;
        const mines = () => minable.map((id) => resourceLabel(config.resources, id)).join(', ');

        if (requested === null) {
            const [sole, ...rest] = minable;
            if (sole !== undefined && rest.length === 0) {
                return sole;
            }
            throw new Error(
                `The ${view.name} mines several resources (${mines()}); pass targetResourceId to pick one.`,
            );
        }
        if (!minable.includes(requested)) {
            throw new Error(
                `The ${view.name} cannot mine ${resourceLabel(config.resources, requested)}; it mines: ${mines()}.`,
            );
        }
        return requested;
    }

    private decodeMined(
        logs: Array<Log>,
        cell: Address,
    ): { resource: number; amount: bigint; claimedBatches: number } | null {
        const events = parseEventLogs({ abi: CELL_ABI, eventName: 'ResourceMined', logs });
        const event = events.find((e) => e.address.toLowerCase() === cell.toLowerCase());
        if (event === undefined) {
            return null;
        }
        return { resource: event.args.resource, amount: event.args.amount, claimedBatches: event.args.claimedBatches };
    }

    private decodeStarted(
        logs: Array<Log>,
        cell: Address,
    ): { resource: number; durationSec: number; yieldPerCycle: number; batches: number } | null {
        const events = parseEventLogs({ abi: CELL_ABI, eventName: 'MiningStarted', logs });
        const event = events.find((e) => e.address.toLowerCase() === cell.toLowerCase());
        if (event === undefined) {
            return null;
        }
        return {
            resource: event.args.resource,
            durationSec: event.args.durationSec,
            yieldPerCycle: Number(event.args.yieldPerCycle),
            batches: event.args.batches,
        };
    }
}
