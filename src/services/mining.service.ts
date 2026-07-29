import { isAddress, parseEventLogs, type Address, type Hash, type Log } from 'viem';

import { MAX_APPROVE_AMOUNT } from './allowance.constants.js';
import { decodeBurnedCpu, feeWeiOf } from './burn.utils.js';
import {
    type AppConfig,
    type CatalogBuildingView,
    type MiningClaimResult,
    type MiningServiceOptions,
    type MiningStatusResult,
    type ModeCostView,
    type ModeSwitchCharge,
    type StartMiningInput,
    type StartMiningResult,
    type IAllowanceService,
    type IAppConfig,
    type ICellClient,
    ModeCostKind,
} from './types.js';
import { BuildingKind } from '../api/types.js';
import { CELL_ABI } from '../contracts/cell.abi.js';
import type { ILogger } from '../logger/types.js';
import { modeCost } from '../map/mode.utils.js';
import { toSettleConfig } from '../map/reader.utils.js';
import { cellProcessProgress } from '../map/settle.utils.js';
import { CellProcessKind, type Cell, type RevealCellReader } from '../map/types.js';
import { cpuFromWei, formatUnixSeconds, resourceLabel } from '../utils/format.utils.js';
import type { IContractClient, WalletProvider } from '../wallet/types.js';

export class MiningService {
    private readonly wallet: WalletProvider;
    private readonly appConfig: IAppConfig;
    private readonly allowance: IAllowanceService;
    private readonly cellClient: ICellClient;
    private readonly contracts: IContractClient;
    private readonly mapReader: RevealCellReader;
    private readonly logger: ILogger;

    constructor(options: MiningServiceOptions) {
        this.wallet = options.wallet;
        this.appConfig = options.appConfig;
        this.allowance = options.allowance;
        this.cellClient = options.cellClient;
        this.contracts = options.contracts;
        this.mapReader = options.mapReader;
        this.logger = options.logger;
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
        const { progress, settlement } = cellProcessProgress(state, process, serverTime, toSettleConfig(config));

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
            ...progress,
            claimable: settlement.minedUnits.toString(),
            depositRemaining: deposit,
            stalled: process.stalled,
            warehouseUsed: storage?.used ?? null,
            warehouseCap: storage?.cap ?? null,
        };
    }

    async claim(tokenId: string): Promise<MiningClaimResult> {
        const config = await this.appConfig.load();
        const wallet = this.wallet.get();
        if (config.chainId !== wallet.getChainId()) {
            throw new Error(
                `Chain mismatch: the chain config is chainId ${config.chainId} but the wallet is on ${wallet.getChainId()}. Check NETWORK.`,
            );
        }

        const cell = config.contracts.cell;
        if (!isAddress(cell, { strict: false })) {
            throw new Error(`Cell contract is not configured for network ${config.network}; cannot claim.`);
        }

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
        const config = await this.appConfig.load();
        const wallet = this.wallet.get();
        if (config.chainId !== wallet.getChainId()) {
            throw new Error(
                `Chain mismatch: the chain config is chainId ${config.chainId} but the wallet is on ${wallet.getChainId()}. Check NETWORK.`,
            );
        }

        const cell = config.contracts.cell;
        if (!isAddress(cell, { strict: false })) {
            throw new Error(`Cell contract is not configured for network ${config.network}; cannot start mining.`);
        }

        await this.mapReader.refresh();
        const state = await this.mapReader.readRevealCell(input.tokenId);
        const { target, view } = this.resolveMiningTarget(config, state, input, wallet.getAddress());

        const tokenId = BigInt(input.tokenId);
        const priced = await this.priceContext(config, cell, tokenId, view, state?.building?.modeResource ?? null);
        const cost = modeCost(priced.view, priced.mode, target);
        const approveTxHash = await this.approveFee(config, cell, cost);

        this.logger.info('starting mining', {
            tokenId: input.tokenId,
            target,
            batches: input.batches,
            switchCost: cost,
            switchCostExact: priced.exact,
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
            modeSwitch: this.chargeOf(config, cost, priced.exact, confirmed.logs),
            approveTxHash,
            txHash: confirmed.txHash,
            status: confirmed.status,
            blockNumber: confirmed.blockNumber,
        };
    }

    private async priceContext(
        config: AppConfig,
        cell: Address,
        tokenId: bigint,
        mapView: CatalogBuildingView,
        mapMode: number | null,
    ): Promise<{ mode: number | null; view: CatalogBuildingView | null; exact: boolean }> {
        try {
            const chain = await this.cellClient.readCellView(cell, tokenId);
            const view = config.buildings.find((b) => b.onChainId === chain.buildingType) ?? null;
            return { mode: chain.modeResource === 0 ? null : chain.modeResource, view, exact: true };
        } catch (error) {
            this.logger.warn('could not read the cell mode on-chain — pricing the switch off the map', {
                tokenId: tokenId.toString(),
                error,
            });
            return { mode: mapMode, view: mapView, exact: false };
        }
    }

    private async approveFee(config: AppConfig, cell: Address, cost: ModeCostView): Promise<Hash | null> {
        if (cost.kind === ModeCostKind.Free) {
            return null;
        }
        const cpuToken = config.contracts.cpuToken;
        if (!isAddress(cpuToken, { strict: false })) {
            throw new Error(`$CPU token is not configured for network ${config.network}; cannot pay to switch.`);
        }
        const needed = cost.kind === ModeCostKind.Paid ? feeWeiOf(cost) : MAX_APPROVE_AMOUNT;
        return this.allowance.ensureAllowance(cpuToken, cell, needed);
    }

    private chargeOf(config: AppConfig, cost: ModeCostView, exact: boolean, logs: Array<Log>): ModeSwitchCharge {
        const cpuToken = config.contracts.cpuToken;
        if (!isAddress(cpuToken, { strict: false })) {
            return { cost, exact, burnedCpu: null };
        }
        const burned = decodeBurnedCpu(logs, cpuToken, this.wallet.get().getAddress());
        return { cost, exact, burnedCpu: cpuFromWei(burned.toString()) };
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
