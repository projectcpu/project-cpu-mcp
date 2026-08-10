import {
    encodeAbiParameters,
    encodeErrorResult,
    encodeEventTopics,
    zeroAddress,
    type Abi,
    type Address,
    type Hash,
    type Hex,
    type Log,
} from 'viem';

import type { ApiClient } from '../../api/client.js';
import { BuildingKind, BuildingType, CraftRecipeId, RandomnessKind } from '../../api/types.js';
import { Network } from '../../config/types.js';
import { ERC20_ABI } from '../../contracts/erc20.abi.js';
import { SYNDICATE_ABI } from '../../contracts/syndicate.abi.js';
import { TRANSPORT_ABI } from '../../contracts/transport.abi.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type { ILogger } from '../../logger/types.js';
import { toCell } from '../../map/cell-view.utils.js';
import { toProjectionConfig } from '../../map/reader.utils.js';
import type { Cell, RawCell, RevealCellReader } from '../../map/types.js';
import {
    type ConfirmedTx,
    type GasEstimateRequest,
    type IContractClient,
    type ReadContractParams,
    type TransactionRequest,
    type TxReceipt,
    TxStatus,
    type WalletManager,
    type WalletProvider,
} from '../../wallet/types.js';
import { CellClient } from '../cell.client.js';
import {
    type AppConfig,
    type CellViewResult,
    type CreateRegistryParams,
    type IAllowanceService,
    type IAppConfig,
    type ICellClient,
    type ISyndicateRegistryClient,
    type JoinRegistryParams,
    type LeaveRegistryParams,
    type SetParamsRegistryParams,
    type SyndicateRegistryConfig,
    type TransferManagerRegistryParams,
    ModeSwitchKind,
} from '../types.js';

/**
 * Shared in-memory doubles for the paid-action services (build / reveal / transport / craft), which
 * all take the same `{ api, wallet, appConfig, allowance, logger }` dependencies.
 */

export const CPU_TOKEN = '0x2222222222222222222222222222222222222222';
export const LAND = '0x3333333333333333333333333333333333333333';
export const CPU_HOOK = '0x4444444444444444444444444444444444444444';
export const CELL = '0x5555555555555555555555555555555555555555';
export const CELL_LENS = '0x6666666666666666666666666666666666666666';
export const TRANSPORT = '0x7777777777777777777777777777777777777777';
export const TRADE = '0x8888888888888888888888888888888888888888';
export const SYNDICATE = '0x9999999999999999999999999999999999999999';
export const RANDOMNESS_ADAPTER = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';
export const WALLET_ADDRESS = '0x000000000000000000000000000000000000dEaD' as Address;
export const APPROVE_HASH = `0x${'c'.repeat(64)}` as Hash;
export const R = `0x${'a'.repeat(64)}` as Hex;
export const S = `0x${'b'.repeat(64)}` as Hex;

export function makeConfig(cpuToken: string = CPU_TOKEN): AppConfig {
    return {
        network: Network.ETHEREUM,
        chainId: 1,
        contracts: {
            land: LAND,
            cpuToken,
            cpuHook: CPU_HOOK,
            cell: CELL,
            cellLens: CELL_LENS,
            transport: TRANSPORT,
            trade: TRADE,
            syndicate: SYNDICATE,
        },
        randomness: { kind: RandomnessKind.ENTROPY, adapter: RANDOMNESS_ADAPTER },
        resources: { 1: 'WCPU', 5: 'Iron', 6: 'Copper', 7: 'Water', 101: 'Concrete', 102: 'Steel' },
        recipes: [
            {
                id: CraftRecipeId.SmeltSteel,
                name: 'Smelt Steel',
                tier: 2,
                inputs: [{ resourceId: 5, amount: 4 }],
                outputs: [{ resourceId: 102, amount: 2 }],
                durationSec: 60,
                costCpu: '0',
            },
            {
                id: CraftRecipeId.ForgeWcpu,
                name: 'CPU Forge',
                tier: 5,
                inputs: [],
                outputs: [{ resourceId: 1, amount: 1 }],
                durationSec: 3600,
                costCpu: '100',
            },
        ],
        buildings: [
            {
                type: BuildingType.Mine,
                onChainId: 4,
                name: 'Mine',
                kind: BuildingKind.Extractor,
                tier: 1,
                buildCost: '5',
                buildTimeSec: 120,
                buildInputs: [],
                demolishCost: { cpu: '2.5', inputs: [] },
                modeSwitchCost: '1',
                modeSwitch: { kind: ModeSwitchKind.Possible, costCpu: '1' },
                minableResources: [5, 6],
                recipes: [],
                effects: { cycleTimeBp: 10000, extractionShareBp: 10000, inputEfficiency: [] },
                recipeOpexCpu: null,
                upgradeFrom: null,
            },
            {
                type: BuildingType.SteelMill,
                onChainId: 11,
                name: 'Steel Mill',
                kind: BuildingKind.Crafter,
                tier: 2,
                buildCost: '20',
                buildTimeSec: 900,
                buildInputs: [{ resourceId: 101, amount: 8 }],
                demolishCost: { cpu: '10', inputs: [{ resourceId: 101, amount: 2 }] },
                modeSwitchCost: null,
                modeSwitch: { kind: ModeSwitchKind.Impossible },
                minableResources: [],
                recipes: [CraftRecipeId.SmeltSteel],
                effects: { cycleTimeBp: 10000, extractionShareBp: 10000, inputEfficiency: [] },
                recipeOpexCpu: null,
                upgradeFrom: null,
            },
            {
                type: BuildingType.WaferFab,
                onChainId: 17,
                name: 'Wafer Fab',
                kind: BuildingKind.Crafter,
                tier: 3,
                buildCost: '88',
                buildTimeSec: 1200,
                buildInputs: [],
                demolishCost: { cpu: '44', inputs: [] },
                modeSwitchCost: '22',
                modeSwitch: { kind: ModeSwitchKind.Possible, costCpu: '22' },
                minableResources: [],
                recipes: [CraftRecipeId.SmeltSteel, CraftRecipeId.ForgeWcpu],
                effects: { cycleTimeBp: 10000, extractionShareBp: 10000, inputEfficiency: [] },
                recipeOpexCpu: null,
                upgradeFrom: null,
            },
            {
                type: BuildingType.Hub,
                onChainId: 23,
                name: 'Hub',
                kind: BuildingKind.Hub,
                tier: 1,
                buildCost: '40',
                buildTimeSec: 120,
                buildInputs: [],
                demolishCost: { cpu: '20', inputs: [] },
                modeSwitchCost: null,
                modeSwitch: { kind: ModeSwitchKind.Impossible },
                minableResources: [],
                recipes: [],
                effects: { cycleTimeBp: 10000, extractionShareBp: 10000, inputEfficiency: [] },
                recipeOpexCpu: null,
                upgradeFrom: null,
            },
            {
                type: BuildingType.PumpStation,
                onChainId: 1,
                name: 'Pump Station',
                kind: BuildingKind.Extractor,
                tier: 1,
                buildCost: '8',
                buildTimeSec: 120,
                buildInputs: [],
                demolishCost: { cpu: '4', inputs: [] },
                modeSwitchCost: null,
                modeSwitch: { kind: ModeSwitchKind.Impossible },
                minableResources: [7],
                recipes: [],
                effects: { cycleTimeBp: 10000, extractionShareBp: 10000, inputEfficiency: [] },
                recipeOpexCpu: null,
                upgradeFrom: null,
            },
        ],
        reveal: { firstFree: true, reRevealCost: '0' },
        transport: {
            moveRadius: 1,
            hubRadius: 3,
            moveTimePerCellSec: 2,
            moveFeeFloors: { 1: '0', 5: '0', 6: '0', 7: '0', 101: '0', 102: '0' },
        },
        trade: { saleBurnPercent: 1, maxSaleFeePercent: 50 },
        storage: { hubStorageMultiplier: 10 },
    };
}

export class FakeAppConfig implements IAppConfig {
    constructor(private readonly config: AppConfig) {}
    async load(): Promise<AppConfig> {
        return this.config;
    }
}

export interface RecordedCall {
    method: string;
    path: string;
    body: unknown;
    authenticated: boolean;
}

export class FakeApi {
    public readonly calls: Array<RecordedCall> = [];
    constructor(private readonly response: { status: number; data: unknown }) {}

    async authenticatedRequest(
        path: string,
        options: { method: string; body: unknown } | null = null,
    ): Promise<{ status: number; data: unknown }> {
        this.calls.push({ method: options?.method ?? 'GET', path, body: options?.body ?? null, authenticated: true });
        return this.response;
    }

    async request(
        path: string,
        options: { method: string; body: unknown } | null = null,
    ): Promise<{ status: number; data: unknown }> {
        this.calls.push({ method: options?.method ?? 'GET', path, body: options?.body ?? null, authenticated: false });
        return this.response;
    }
}

export class FakeAllowance implements IAllowanceService {
    public readonly calls: Array<{ token: string; spender: string; needed: bigint }> = [];
    constructor(private readonly result: Hash | null | Error = null) {}
    async ensureAllowance(token: Address, spender: Address, needed: bigint): Promise<Hash | null> {
        this.calls.push({ token, spender, needed });
        if (this.result instanceof Error) {
            throw this.result;
        }
        return this.result;
    }
}

export class FakeWallet implements WalletManager, WalletProvider {
    public readonly sent: Array<TransactionRequest> = [];
    public readonly reads: Array<ReadContractParams> = [];
    private receiptIndex = 0;

    constructor(
        private readonly chainId: number,
        private readonly receipts: Array<TxStatus> = [],
        private readonly usedSignId: boolean = false,
    ) {}

    get(): WalletManager {
        return this;
    }
    isReady(): boolean {
        return true;
    }
    getAddress(): Address {
        return WALLET_ADDRESS;
    }
    getChainId(): number {
        return this.chainId;
    }
    async sendTransaction(tx: TransactionRequest): Promise<Hash> {
        this.sent.push(tx);
        return `0x${String(this.sent.length).padStart(64, '0')}` as Hash;
    }
    async estimateGas(): Promise<bigint> {
        return 21000n;
    }
    async getGasPrice(): Promise<bigint> {
        return 1_000_000_000n;
    }
    async waitForReceipt(hash: Hash): Promise<TxReceipt> {
        const status = this.receipts[this.receiptIndex] ?? TxStatus.Success;
        this.receiptIndex += 1;
        return { status, transactionHash: hash, blockNumber: 100n, logs: [] };
    }
    async readContract(params: ReadContractParams): Promise<unknown> {
        this.reads.push(params);
        return this.usedSignId;
    }
    async getBalance(): Promise<bigint> {
        return 0n;
    }
    async signMessage(): Promise<Hex> {
        return '0x';
    }
}

/** The common dependency bundle every paid-action service constructor accepts. */
export interface PaidServiceOptions {
    api: ApiClient;
    wallet: WalletProvider;
    appConfig: IAppConfig;
    allowance: IAllowanceService;
    logger: ILogger;
}

export type HarnessOptions = { response: { status: number; data: unknown } } & Partial<{
    receipts: Array<TxStatus>;
    walletChainId: number;
    usedSignId: boolean;
    config: AppConfig;
    approve: Hash | null | Error;
}>;

export interface Harness<T> {
    service: T;
    api: FakeApi;
    wallet: FakeWallet;
    allowance: FakeAllowance;
}

/** Wires the fakes into a service built by `create`, returning the service plus the doubles to assert on. */
export function makeHarness<T>(create: (opts: PaidServiceOptions) => T, opts: HarnessOptions): Harness<T> {
    const api = new FakeApi(opts.response);
    const wallet = new FakeWallet(opts.walletChainId ?? 1, opts.receipts ?? [], opts.usedSignId ?? false);
    const allowance = new FakeAllowance(opts.approve ?? null);
    const service = create({
        api: api as unknown as ApiClient,
        wallet: wallet as unknown as WalletProvider,
        appConfig: new FakeAppConfig(opts.config ?? makeConfig()),
        allowance,
        logger: new NoopLogger(),
    });
    return { service, api, wallet, allowance };
}

export type FakeReadResult = unknown | Error;

export class FakeContractClient implements IContractClient {
    public readonly sent: Array<TransactionRequest> = [];
    public readonly reads: Array<ReadContractParams> = [];
    public readonly estimates: Array<GasEstimateRequest> = [];
    private confirmIndex = 0;

    constructor(
        private readonly receipts: Array<TxStatus> = [],
        private readonly logsByConfirm: Array<Array<Log>> = [],
        private readonly readsByFunction: Record<string, FakeReadResult> = {},
        private readonly gasEstimate: bigint = 21_000n,
    ) {}

    async read<T>(params: ReadContractParams): Promise<T> {
        this.reads.push(params);
        const result = this.readsByFunction[params.functionName];
        if (result instanceof Error) {
            throw result;
        }
        return result as T;
    }
    async estimateGas(tx: GasEstimateRequest): Promise<bigint> {
        this.estimates.push(tx);
        return this.gasEstimate;
    }
    async send(tx: TransactionRequest, _errorAbi: Abi | null): Promise<Hash> {
        this.sent.push(tx);
        return `0x${String(this.sent.length).padStart(64, '0')}` as Hash;
    }
    async confirm(hash: Hash, revertLabel: string): Promise<ConfirmedTx> {
        const status = this.receipts[this.confirmIndex] ?? TxStatus.Success;
        const logs = this.logsByConfirm[this.confirmIndex] ?? [];
        this.confirmIndex += 1;
        if (status === TxStatus.Reverted) {
            throw new Error(`${revertLabel} reverted on-chain (tx ${hash}).`);
        }
        return { txHash: hash, status, blockNumber: '100', logs };
    }
}

// The chain's `getCell`, whose mode fields use 0 for "no output picked yet".
export function chainCellView(overrides: Partial<CellViewResult> = {}): CellViewResult {
    return { buildingType: 4, modeResource: 0, modeRecipeId: 0n, ...overrides };
}

export function cpuBurnLog(from: Address, amountWei: bigint): Log {
    const topics = encodeEventTopics({ abi: ERC20_ABI, eventName: 'Transfer', args: { from, to: zeroAddress } });
    const data = encodeAbiParameters([{ type: 'uint256' }], [amountWei]);
    return {
        address: CPU_TOKEN as Address,
        topics,
        data,
        blockHash: `0x${'0'.repeat(64)}`,
        blockNumber: 1n,
        logIndex: 1,
        transactionHash: `0x${'0'.repeat(64)}`,
        transactionIndex: 0,
        removed: false,
    } as unknown as Log;
}

export function transitSettledLog(args: { deliveryId: bigint; owner: Address; gross: bigint; discount: bigint }): Log {
    const topics = encodeEventTopics({
        abi: TRANSPORT_ABI,
        eventName: 'TransitFeeSettled',
        args: { deliveryId: args.deliveryId, payer: WALLET_ADDRESS, owner: args.owner },
    });
    const data = encodeAbiParameters(
        [
            { name: 'gross', type: 'uint256' },
            { name: 'burn', type: 'uint256' },
            { name: 'discount', type: 'uint256' },
            { name: 'tax', type: 'uint256' },
            { name: 'ownerNet', type: 'uint256' },
            { name: 'payerSyndicateId', type: 'uint256' },
            { name: 'ownerSyndicateId', type: 'uint256' },
            { name: 'taxTo', type: 'address' },
            { name: 'settledAt', type: 'uint64' },
        ],
        [args.gross, args.gross - args.discount, args.discount, 0n, 0n, 0n, 0n, zeroAddress, 0n],
    );
    return {
        address: TRANSPORT as Address,
        topics,
        data,
        blockNumber: 100n,
        blockHash: `0x${'0'.repeat(64)}`,
        logIndex: 2,
        transactionHash: `0x${'0'.repeat(64)}`,
        transactionIndex: 0,
        removed: false,
    } as unknown as Log;
}

// A large default so `startAt: 1` fixtures mature far more cycles than any cap — tests that need an exact
// cycle count pass an explicit `serverTime`.
export const DEFAULT_SERVER_TIME = 1_000_000_000;

export class FakeMapReader implements RevealCellReader {
    public refreshed = 0;
    constructor(
        private readonly cell: Cell | null = null,
        private readonly serverTime: number = DEFAULT_SERVER_TIME,
    ) {}
    async readRevealCell(): Promise<Cell | null> {
        return this.cell;
    }
    getServerTime(): number {
        return this.serverTime;
    }
    async refresh(): Promise<void> {
        this.refreshed += 1;
    }
}

export function memberJoinedLog(args: { player: Address; id: bigint; joinedAt: bigint; registry: Address }): Log {
    const topics = encodeEventTopics({
        abi: SYNDICATE_ABI,
        eventName: 'MemberJoined',
        args: { player: args.player, id: args.id },
    });
    const data = encodeAbiParameters([{ name: 'joinedAt', type: 'uint64' }], [args.joinedAt]);
    return {
        address: args.registry,
        topics,
        data,
        blockNumber: 100n,
        blockHash: `0x${'0'.repeat(64)}`,
        logIndex: 0,
        transactionHash: `0x${'0'.repeat(64)}`,
        transactionIndex: 0,
        removed: false,
    } as unknown as Log;
}

export function memberLeftLog(args: { player: Address; id: bigint; registry: Address }): Log {
    const topics = encodeEventTopics({
        abi: SYNDICATE_ABI,
        eventName: 'MemberLeft',
        args: { player: args.player, id: args.id },
    });
    return {
        address: args.registry,
        topics,
        data: '0x',
        blockNumber: 100n,
        blockHash: `0x${'0'.repeat(64)}`,
        logIndex: 0,
        transactionHash: `0x${'0'.repeat(64)}`,
        transactionIndex: 0,
        removed: false,
    } as unknown as Log;
}

export function syndicateCreatedLog(args: {
    id: bigint;
    creator: Address;
    manager: Address;
    name: string;
    link: string;
    ratesBp: [number, number, number, number];
    createdAt: bigint;
    registry: Address;
}): Log {
    const topics = encodeEventTopics({
        abi: SYNDICATE_ABI,
        eventName: 'SyndicateCreated',
        args: { id: args.id, creator: args.creator, manager: args.manager },
    });
    const data = encodeAbiParameters(
        [
            { name: 'name', type: 'string' },
            { name: 'link', type: 'string' },
            {
                name: 'rates',
                type: 'tuple',
                components: [
                    { name: 'tradeDiscountBp', type: 'uint16' },
                    { name: 'transportDiscountBp', type: 'uint16' },
                    { name: 'tradeTaxBp', type: 'uint16' },
                    { name: 'transportTaxBp', type: 'uint16' },
                ],
            },
            { name: 'createdAt', type: 'uint64' },
        ],
        [
            args.name,
            args.link,
            {
                tradeDiscountBp: args.ratesBp[0],
                transportDiscountBp: args.ratesBp[1],
                tradeTaxBp: args.ratesBp[2],
                transportTaxBp: args.ratesBp[3],
            },
            args.createdAt,
        ],
    );
    return {
        address: args.registry,
        topics,
        data,
        blockNumber: 100n,
        blockHash: `0x${'0'.repeat(64)}`,
        logIndex: 1,
        transactionHash: `0x${'0'.repeat(64)}`,
        transactionIndex: 0,
        removed: false,
    } as unknown as Log;
}

export function syndicateRevert(
    errorName:
        | 'SyndicateNotFound'
        | 'AlreadyInSyndicate'
        | 'NotInSyndicate'
        | 'CooldownActive'
        | 'ZeroAddress'
        | 'NotManager'
        | 'RateTooHigh'
        | 'NameEmpty'
        | 'NameTooLong'
        | 'LinkTooLong',
): Error {
    const data = encodeErrorResult({ abi: SYNDICATE_ABI, errorName });
    const error = new Error(`Execution reverted: ${errorName}()`) as Error & { data: Hex };
    error.data = data;
    return error;
}

export interface SyndicateRegistryOutcomes {
    join: ConfirmedTx | Error;
    leave: ConfirmedTx | Error;
    create: ConfirmedTx | Error;
    setParams: ConfirmedTx | Error;
    transferManager: ConfirmedTx | Error;
    config: SyndicateRegistryConfig;
}

export class FakeSyndicateRegistryClient implements ISyndicateRegistryClient {
    public readonly joinCalls: Array<JoinRegistryParams> = [];
    public readonly leaveCalls: Array<LeaveRegistryParams> = [];
    public readonly createCalls: Array<CreateRegistryParams> = [];
    public readonly setParamsCalls: Array<SetParamsRegistryParams> = [];
    public readonly transferManagerCalls: Array<TransferManagerRegistryParams> = [];
    public getConfigCalls = 0;

    constructor(private readonly outcomes: Partial<SyndicateRegistryOutcomes> = {}) {}

    async join(params: JoinRegistryParams): Promise<ConfirmedTx> {
        this.joinCalls.push(params);
        return resolveTx(this.outcomes.join, 'join');
    }

    async leave(params: LeaveRegistryParams): Promise<ConfirmedTx> {
        this.leaveCalls.push(params);
        return resolveTx(this.outcomes.leave, 'leave');
    }

    async create(params: CreateRegistryParams): Promise<ConfirmedTx> {
        this.createCalls.push(params);
        return resolveTx(this.outcomes.create, 'create');
    }

    async setParams(params: SetParamsRegistryParams): Promise<ConfirmedTx> {
        this.setParamsCalls.push(params);
        return resolveTx(this.outcomes.setParams, 'setParams');
    }

    async transferManager(params: TransferManagerRegistryParams): Promise<ConfirmedTx> {
        this.transferManagerCalls.push(params);
        return resolveTx(this.outcomes.transferManager, 'transferManager');
    }

    async getConfig(_registry: Address): Promise<SyndicateRegistryConfig> {
        this.getConfigCalls += 1;
        return this.outcomes.config ?? { exitCooldownSec: 0 };
    }
}

function resolveTx(outcome: ConfirmedTx | Error | undefined, label: string): ConfirmedTx {
    if (outcome === undefined) {
        throw new Error(`FakeSyndicateRegistryClient.${label} was called with no configured outcome`);
    }
    if (outcome instanceof Error) {
        throw outcome;
    }
    return outcome;
}

export function confirmedTx(logs: Array<Log>): ConfirmedTx {
    return { txHash: `0x${'e'.repeat(64)}` as Hash, status: TxStatus.Success, blockNumber: '100', logs };
}

export interface CellServiceDeps {
    wallet: WalletProvider;
    appConfig: IAppConfig;
    allowance: IAllowanceService;
    cellClient: ICellClient;
    contracts: IContractClient;
    mapReader: RevealCellReader;
    logger: ILogger;
}

export type CellHarnessOptions = Partial<{
    receipts: Array<TxStatus>;
    logs: Array<Array<Log>>;
    walletChainId: number;
    config: AppConfig;
    approve: Hash | null | Error;
    cell: RawCell | null;
    serverTime: number;
    reads: Record<string, FakeReadResult>;
}>;

export interface CellHarness<T> {
    service: T;
    wallet: FakeWallet;
    allowance: FakeAllowance;
    contracts: FakeContractClient;
    cellClient: CellClient;
    mapReader: FakeMapReader;
}

export function makeCellHarness<T>(
    create: (deps: CellServiceDeps) => T,
    opts: CellHarnessOptions = {},
): CellHarness<T> {
    const wallet = new FakeWallet(opts.walletChainId ?? 1);
    const allowance = new FakeAllowance(opts.approve ?? null);
    const contracts = new FakeContractClient(
        opts.receipts ?? [],
        opts.logs ?? [],
        opts.reads ?? { getCell: chainCellView() },
    );
    const cellClient = new CellClient({ contracts, logger: new NoopLogger() });
    const config = opts.config ?? makeConfig();
    const serverTime = opts.serverTime ?? DEFAULT_SERVER_TIME;
    const raw = opts.cell ?? null;
    const mapReader = new FakeMapReader(
        raw === null ? null : toCell(raw, serverTime, toProjectionConfig(config)),
        serverTime,
    );
    const service = create({
        wallet,
        appConfig: new FakeAppConfig(config),
        allowance,
        cellClient,
        contracts,
        mapReader,
        logger: new NoopLogger(),
    });
    return { service, wallet, allowance, contracts, cellClient, mapReader };
}
