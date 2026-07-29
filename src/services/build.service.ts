import { isAddress, parseEther, parseEventLogs, type Address, type Hash, type Log } from 'viem';

import type {
    AppConfig,
    BuildInput,
    BuildPlacement,
    BuildResult,
    BuildServiceOptions,
    DemolishInput,
    DemolishResult,
    IAllowanceService,
    IAppConfig,
    ICellClient,
} from './types.js';
import { assertWarehouseHas } from './warehouse.utils.js';
import { BuildingKind } from '../api/types.js';
import type { BuildingView } from '../api/types.js';
import { CELL_ABI } from '../contracts/cell.abi.js';
import type { ILogger } from '../logger/types.js';
import { demolishCooldownEnd } from '../map/map.utils.js';
import type { Cell, RevealCellReader } from '../map/types.js';
import { formatUnixSeconds } from '../utils/format.utils.js';
import type { IContractClient, WalletManager, WalletProvider } from '../wallet/types.js';

export class BuildService {
    private readonly wallet: WalletProvider;
    private readonly appConfig: IAppConfig;
    private readonly allowance: IAllowanceService;
    private readonly cellClient: ICellClient;
    private readonly contracts: IContractClient;
    private readonly mapReader: RevealCellReader;
    private readonly logger: ILogger;

    constructor(options: BuildServiceOptions) {
        this.wallet = options.wallet;
        this.appConfig = options.appConfig;
        this.allowance = options.allowance;
        this.cellClient = options.cellClient;
        this.contracts = options.contracts;
        this.mapReader = options.mapReader;
        this.logger = options.logger;
    }

    async build(input: BuildInput): Promise<BuildResult> {
        const config = await this.appConfig.load();
        const wallet = this.wallet.get();
        this.assertChain(config, wallet);

        const cell = this.requireCell(config);
        const cpuToken = this.requireCpuToken(config);
        const tokenId = BigInt(input.tokenId);

        // Paid action — pull a fresh snapshot so the pre-checks below gate on current on-chain state, not a
        // possibly-stale local cache (mirrors mining's start path).
        await this.mapReader.refresh();
        const state = await this.mapReader.readRevealCell(input.tokenId);
        this.assertBuildable(input, state, wallet.getAddress());

        const alreadyBuilt = state?.building?.type === input.buildingType;
        const placement: BuildPlacement = alreadyBuilt
            ? { buildTxHash: null, approveTxHash: null, buildCost: '0' }
            : await this.placeBuilding(config, cell, cpuToken, input, tokenId, state);

        return {
            tokenId: input.tokenId,
            buildingType: input.buildingType,
            buildCost: placement.buildCost,
            approveTxHash: placement.approveTxHash,
            buildTxHash: placement.buildTxHash,
            alreadyBuilt,
        };
    }

    async demolish(input: DemolishInput): Promise<DemolishResult> {
        const config = await this.appConfig.load();
        const wallet = this.wallet.get();
        this.assertChain(config, wallet);

        const cell = this.requireCell(config);
        const cpuToken = this.requireCpuToken(config);
        const tokenId = BigInt(input.tokenId);

        await this.mapReader.refresh();
        const state = await this.mapReader.readRevealCell(input.tokenId);
        this.assertOwner(input.tokenId, state, wallet.getAddress(), 'demolish');
        if (state === null || state.building === null) {
            throw new Error(
                `Cell ${input.tokenId} has no building to demolish (it may be empty, or not synced to the map ` +
                    `yet — retry shortly).`,
            );
        }
        const building = state.building;
        this.assertNoProcess(input.tokenId, state, 'demolish');

        const view = this.buildingView(config, building.type);
        this.assertHubIdle(input.tokenId, view, state);
        assertWarehouseHas(config.resources, state, view.demolishCost.inputs, input.tokenId, 'demolish');

        // Demolish burns $CPU on-chain (`burnFrom`), so the Cell must be allowed to pull it — same approval the
        // build path uses. The warehouse inputs are debited internally and need no approval.
        const approveTxHash = await this.approveCpuSpend(cpuToken, cell, view.demolishCost.cpu);

        this.logger.info('demolishing building', {
            tokenId: input.tokenId,
            buildingType: building.type,
            cpuBurned: view.demolishCost.cpu,
            network: config.network,
        });
        const txHash = await this.cellClient.demolish({ cell, tokenId });
        const confirmed = await this.contracts.confirm(txHash, 'Demolish transaction');

        const rebuildUnlockAt = this.decodeDemolishFinish(confirmed.logs, cell);
        const rebuildCooldownSec =
            rebuildUnlockAt === null ? null : Math.max(0, rebuildUnlockAt - this.mapReader.getServerTime());

        return {
            tokenId: input.tokenId,
            buildingType: building.type,
            cpuBurned: view.demolishCost.cpu,
            inputsConsumed: view.demolishCost.inputs,
            rebuildUnlockAt,
            rebuildCooldownSec,
            approveTxHash,
            txHash: confirmed.txHash,
            status: confirmed.status,
            blockNumber: confirmed.blockNumber,
        };
    }

    private decodeDemolishFinish(logs: Array<Log>, cell: Address): number | null {
        const events = parseEventLogs({ abi: CELL_ABI, eventName: 'BuildingDemolished', logs });
        const event = events.find((e) => e.address.toLowerCase() === cell.toLowerCase());
        return event === undefined ? null : Number(event.args.demolishFinishAt);
    }

    private assertBuildable(input: BuildInput, state: Cell | null, address: string): void {
        this.assertOwner(input.tokenId, state, address, 'build');
        if (state === null) {
            return;
        }
        const cooldownEnd = demolishCooldownEnd(state, this.mapReader.getServerTime());
        if (cooldownEnd !== null) {
            throw new Error(
                `Cell ${input.tokenId} is in demolition cooldown until ${formatUnixSeconds(cooldownEnd)}; ` +
                    `it cannot be rebuilt yet.`,
            );
        }
        this.assertNoProcess(input.tokenId, state, 'build');
        if (state.building !== null && state.building.type !== input.buildingType) {
            throw new Error(
                `Cell ${input.tokenId} already has a ${state.building.type}; demolish it before building a ${input.buildingType}.`,
            );
        }
    }

    private assertOwner(tokenId: string, state: Cell | null, address: string, action: string): void {
        if (state !== null && state.owner.toLowerCase() !== address.toLowerCase()) {
            throw new Error(`You do not own cell ${tokenId} (owner ${state.owner}); only the owner can ${action}.`);
        }
    }

    private assertNoProcess(tokenId: string, state: Cell, action: string): void {
        if (state.process !== null) {
            throw new Error(
                `Cell ${tokenId} has an active ${state.process.kind} process; claim or finish it before you ${action}.`,
            );
        }
    }

    // A hub anchoring open trade lots (reserved.lots > 0) reverts on-chain with CellBusy. Catch that common case
    // here; the chain still guards in-flight routes, which aren't visible in the local snapshot.
    private assertHubIdle(tokenId: string, view: BuildingView, state: Cell | null): void {
        if (view.kind !== BuildingKind.Hub || state === null) {
            return;
        }
        const anchorsLots = state.resources.some((r) => r.storage !== null && BigInt(r.storage.reserved.lots) > 0n);
        if (anchorsLots) {
            throw new Error(`Cell ${tokenId} hub anchors open trade lots; cancel them before demolishing.`);
        }
    }

    // Approve the Cell to pull `decimalCpu` $CPU before a burn/spend; null when it's free or the allowance already
    // covers it (`ensureAllowance` approves an unbounded amount when short). Shared by build and demolish.
    private async approveCpuSpend(cpuToken: Address, cell: Address, decimalCpu: string): Promise<Hash | null> {
        const wei = parseEther(decimalCpu);
        return wei > 0n ? this.allowance.ensureAllowance(cpuToken, cell, wei) : null;
    }

    private async placeBuilding(
        config: AppConfig,
        cell: Address,
        cpuToken: Address,
        input: BuildInput,
        tokenId: bigint,
        state: Cell | null,
    ): Promise<BuildPlacement> {
        const view = this.buildingView(config, input.buildingType);
        assertWarehouseHas(config.resources, state, view.buildInputs, input.tokenId, 'build');
        const approveTxHash = await this.approveCpuSpend(cpuToken, cell, view.buildCost);

        this.logger.info('placing building', {
            tokenId: input.tokenId,
            buildingType: input.buildingType,
            onChainId: view.onChainId,
            buildCost: view.buildCost,
            network: config.network,
        });
        const buildTxHash = await this.cellClient.place({ cell, tokenId, buildingType: view.onChainId });
        await this.contracts.confirm(buildTxHash, 'Build transaction');

        return { buildTxHash, approveTxHash, buildCost: view.buildCost };
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
            throw new Error(`Cell contract is not configured for network ${config.network}; cannot build.`);
        }
        return cell;
    }

    private requireCpuToken(config: AppConfig): Address {
        const cpuToken = config.contracts.cpuToken;
        if (!isAddress(cpuToken, { strict: false })) {
            throw new Error(`$CPU token is not configured for network ${config.network}; cannot pay for build.`);
        }
        return cpuToken;
    }

    private buildingView(config: AppConfig, buildingType: string): BuildingView {
        const view = config.buildings.find((b) => b.type === buildingType);
        if (view === undefined) {
            throw new Error(`No catalog entry for a ${buildingType} on network ${config.network}.`);
        }
        return view;
    }
}
