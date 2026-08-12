import {
    decodeFunctionData,
    encodeAbiParameters,
    encodeErrorResult,
    encodeEventTopics,
    formatEther,
    getAddress,
    parseEther,
    zeroAddress,
    type Abi,
    type Address,
    type Hash,
    type Hex,
    type Log,
} from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    APPROVE_HASH,
    CELL,
    CPU_TOKEN,
    FakeAllowance,
    FakeWallet,
    RANDOMNESS_ADAPTER,
    WALLET_ADDRESS,
    makeConfig,
} from './service-fakes.js';
import {
    type IRevealRequestsReader,
    type OpenRevealRequestsView,
    type OpenRevealRequestView,
    type RandomnessDescriptor,
    RandomnessKind,
} from '../../api/types.js';
import { CELL_ABI } from '../../contracts/cell.abi.js';
import { RANDOMNESS_ADAPTER_ABI } from '../../contracts/randomness-adapter.abi.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type { Cell, RevealCellReader } from '../../map/types.js';
import { FulfilmentClaims } from '../../randomness/claims.js';
import { DrandRandomnessStrategy } from '../../randomness/drand.strategy.js';
import {
    BeaconRoundOutcome,
    type BeaconRoundResult,
    type IBeaconClient,
    type IRandomnessStrategyFactory,
    type RandomnessStrategy,
} from '../../randomness/types.js';
import { ContractClient } from '../../wallet/contract-client.js';
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
import { RevealService } from '../reveal.service.js';
import { bufferedRevealValue } from '../reveal.utils.js';
import type { AppConfig, CellViewResult, ICellClient, IAppConfig, RequestRevealParams, RevealQuote } from '../types.js';

const REQUEST_HASH = `0x${'e'.repeat(64)}` as Hash;

const DEFAULT_QUOTE: RevealQuote = {
    ethContributionWei: 3_000n,
    randomnessFeeWei: 1_000n,
    totalRequiredWei: 4_000n,
    cpuBurnWei: 0n,
};

function revealState(over: Partial<Cell> = {}): Cell {
    return { tokenId: '42', owner: WALLET_ADDRESS, revealCount: 0, revealPending: false, ...over } as unknown as Cell;
}

class FakeAppConfig implements IAppConfig {
    constructor(private readonly config: AppConfig) {}
    async load(): Promise<AppConfig> {
        return this.config;
    }
}

class FakeCellClient implements ICellClient {
    public readonly requests: Array<RequestRevealParams> = [];
    public readonly quoted: Array<Address> = [];
    constructor(private readonly quote: RevealQuote | Error = DEFAULT_QUOTE) {}
    async readCellView(): Promise<CellViewResult> {
        return { buildingType: 0, modeResource: 0, modeRecipeId: 0n };
    }
    async quoteReveal(cell: Address): Promise<RevealQuote> {
        this.quoted.push(cell);
        if (this.quote instanceof Error) {
            throw this.quote;
        }
        return this.quote;
    }
    async requestReveal(params: RequestRevealParams): Promise<Hash> {
        this.requests.push(params);
        return REQUEST_HASH;
    }
    async place(): Promise<Hash> {
        return REQUEST_HASH;
    }
    async demolish(): Promise<Hash> {
        return REQUEST_HASH;
    }
    async startMining(): Promise<Hash> {
        return REQUEST_HASH;
    }
    async startCraft(): Promise<Hash> {
        return REQUEST_HASH;
    }
    async claim(): Promise<Hash> {
        return REQUEST_HASH;
    }
    async withdrawCpu(): Promise<Hash> {
        return REQUEST_HASH;
    }
}

class FakeContractClient implements IContractClient {
    public readonly reads: Array<ReadContractParams> = [];
    public readonly sent: Array<TransactionRequest> = [];
    constructor(private readonly reverts: boolean = false) {}
    async read<T>(params: ReadContractParams): Promise<T> {
        this.reads.push(params);
        return undefined as T;
    }
    async estimateGas(): Promise<bigint> {
        return 21_000n;
    }
    async send(tx: TransactionRequest, _errorAbi: Abi | null): Promise<Hash> {
        this.sent.push(tx);
        return REQUEST_HASH;
    }
    async confirm(hash: Hash, revertLabel: string): Promise<ConfirmedTx> {
        if (this.reverts) {
            throw new Error(`${revertLabel} reverted on-chain (tx ${hash}).`);
        }
        return { txHash: hash, status: TxStatus.Success, blockNumber: '100', logs: [] };
    }
}

class FakePushRandomnessFactory implements IRandomnessStrategyFactory {
    public readonly calls: Array<{ descriptor: RandomnessDescriptor; cell: Address }> = [];
    async create(descriptor: RandomnessDescriptor, cell: Address): Promise<RandomnessStrategy> {
        this.calls.push({ descriptor, cell });
        return { kind: RandomnessKind.ENTROPY, source: RANDOMNESS_ADAPTER as Address };
    }
}

class FakeRevealCellReader {
    public refreshes = 0;
    constructor(
        private state: Cell | null,
        private readonly bumpTo: number | null = null,
    ) {}
    async readRevealCell(): Promise<Cell | null> {
        return this.state;
    }
    getServerTime(): number {
        return 0;
    }
    async refresh(): Promise<void> {
        this.refreshes += 1;
        if (this.bumpTo !== null && this.state !== null) {
            this.state = { ...this.state, revealCount: this.bumpTo };
        }
    }
}

type HarnessOptions = Partial<{
    config: AppConfig;
    state: Cell | null;
    bumpTo: number | null;
    quote: RevealQuote | Error;
    approve: Hash | null | Error;
    reverts: boolean;
    walletChainId: number;
}>;

function makeReveal(opts: HarnessOptions = {}): {
    service: RevealService;
    wallet: FakeWallet;
    allowance: FakeAllowance;
    cellClient: FakeCellClient;
    contracts: FakeContractClient;
    randomness: FakePushRandomnessFactory;
    reader: FakeRevealCellReader;
} {
    const wallet = new FakeWallet(opts.walletChainId ?? 1);
    const allowance = new FakeAllowance(opts.approve ?? null);
    const cellClient = new FakeCellClient(opts.quote ?? DEFAULT_QUOTE);
    const contracts = new FakeContractClient(opts.reverts ?? false);
    const randomness = new FakePushRandomnessFactory();
    const reader = new FakeRevealCellReader(opts.state === undefined ? revealState() : opts.state, opts.bumpTo ?? null);
    const service = new RevealService({
        wallet: wallet as unknown as WalletProvider,
        appConfig: new FakeAppConfig(opts.config ?? makeConfig()),
        allowance,
        cellClient,
        contracts,
        randomness,
        claims: new FulfilmentClaims(),
        mapReader: reader,
        logger: new NoopLogger(),
    });
    return { service, wallet, allowance, cellClient, contracts, randomness, reader };
}

describe('RevealService on a push randomness source', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('submits a genesis reveal covering the quoted total, with no $CPU to approve on a zero-burn profile', async () => {
        const h = makeReveal({ bumpTo: 1 });

        const p = h.service.reveal('42');
        await vi.runAllTimersAsync();
        const result = await p;

        expect(h.allowance.calls).toHaveLength(0);
        expect(h.cellClient.requests).toEqual([{ cell: CELL, tokenId: 42n, value: 5_000n }]);
        expect(result.genesis).toBe(true);
        expect(result.fee).toBe(formatEther(4_000n));
        expect(result.cpuBurn).toBe('0');
        expect(result.approveTxHash).toBeNull();
        expect(result.requestTxHash).toBe(REQUEST_HASH);
        expect(result.blockNumber).toBe('100');
        expect(result.status).toBe(TxStatus.Success);
        expect(result.fulfilled).toBe(true);
    });

    it('leaves the self-service half of the answer empty, since a pushed draw arrives on its own', async () => {
        const h = makeReveal({ bumpTo: 1 });

        const p = h.service.reveal('42');
        await vi.runAllTimersAsync();
        const result = await p;

        expect(result.fulfillTxHash).toBeNull();
        expect(result.requestId).toBeNull();
        expect(result.round).toBeNull();
        expect(result.deposits).toBeNull();
        expect(result.note).toBeNull();
        expect(result.source).toBe(RANDOMNESS_ADAPTER);
    });

    it('creates the strategy for the configured descriptor and cell, and quotes that same cell', async () => {
        const config = makeConfig();
        const h = makeReveal({ config, bumpTo: 1 });

        const p = h.service.reveal('42');
        await vi.runAllTimersAsync();
        await p;

        expect(h.randomness.calls).toEqual([{ descriptor: config.randomness, cell: CELL }]);
        expect(h.cellClient.quoted).toEqual([CELL]);
    });

    it('funds the reveal from the chain quote, not from the amounts the chain config carries', async () => {
        const config: AppConfig = { ...makeConfig(), reveal: { ethContribution: '1', cpuBurn: '2' } };
        const h = makeReveal({
            config,
            quote: { ethContributionWei: 3_000n, randomnessFeeWei: 1_000n, totalRequiredWei: 4_000n, cpuBurnWei: 9n },
            approve: APPROVE_HASH,
            bumpTo: 1,
        });

        const p = h.service.reveal('42');
        await vi.runAllTimersAsync();
        const result = await p;

        const value = h.cellClient.requests[0]?.value ?? 0n;
        expect(value).toBeGreaterThanOrEqual(4_000n);
        expect(h.allowance.calls).toEqual([{ token: CPU_TOKEN, spender: CELL, needed: 9n }]);
        expect(result.fee).toBe(formatEther(4_000n));
        expect(result.cpuBurn).toBe(formatEther(9n));
    });

    it('covers the quoted total and carries headroom over it, while approving the burn to the wei', async () => {
        const h = makeReveal({
            quote: { ethContributionWei: 3_000n, randomnessFeeWei: 1_000n, totalRequiredWei: 4_000n, cpuBurnWei: 9n },
            approve: APPROVE_HASH,
            bumpTo: 1,
        });

        const p = h.service.reveal('42');
        await vi.runAllTimersAsync();
        await p;

        const value = h.cellClient.requests[0]?.value ?? 0n;
        expect(value).toBeGreaterThanOrEqual(4_000n);
        expect(value).toBe(5_000n);
        expect(h.allowance.calls).toEqual([{ token: CPU_TOKEN, spender: CELL, needed: 9n }]);
    });

    it('still overshoots the contribution when the fee leg quotes zero off-chain, which is when a send of the bare total underpays', async () => {
        const h = makeReveal({
            quote: { ethContributionWei: 3_000n, randomnessFeeWei: 0n, totalRequiredWei: 3_000n, cpuBurnWei: 0n },
            bumpTo: 1,
        });

        const p = h.service.reveal('42');
        await vi.runAllTimersAsync();
        await p;

        expect(h.cellClient.requests[0]?.value).toBeGreaterThan(3_000n);
    });

    it('puts the headroom on the total, so a zero fee leg never shrinks it to nothing', () => {
        expect(bufferedRevealValue(4_000n)).toBe(5_000n);
        expect(bufferedRevealValue(3_000n)).toBe(3_750n);
        expect(bufferedRevealValue(0n)).toBe(0n);
    });

    it('fails the reveal when the cell cannot be quoted, before any request goes out', async () => {
        const h = makeReveal({ quote: new Error('quoteReveal reverted') });

        await expect(h.service.reveal('42')).rejects.toThrow(/quoteReveal reverted/i);
        expect(h.cellClient.requests).toHaveLength(0);
    });

    it('charges a first reveal and a later reveal alike, quoting and approving the same way for both', async () => {
        const quote: RevealQuote = {
            ethContributionWei: 3_000n,
            randomnessFeeWei: 1_000n,
            totalRequiredWei: 4_000n,
            cpuBurnWei: parseEther('1'),
        };
        const first = makeReveal({ quote, approve: APPROVE_HASH, bumpTo: 1 });
        const later = makeReveal({
            quote,
            state: revealState({ revealCount: 1 }),
            approve: APPROVE_HASH,
            bumpTo: 2,
        });

        const firstResult = await (async () => {
            const p = first.service.reveal('42');
            await vi.runAllTimersAsync();
            return p;
        })();
        const laterResult = await (async () => {
            const p = later.service.reveal('42');
            await vi.runAllTimersAsync();
            return p;
        })();

        expect(firstResult.genesis).toBe(true);
        expect(laterResult.genesis).toBe(false);
        expect(first.allowance.calls).toEqual(later.allowance.calls);
        expect(first.cellClient.requests).toEqual(later.cellClient.requests);
        expect(firstResult.fee).toBe(laterResult.fee);
        expect(firstResult.cpuBurn).toBe(laterResult.cpuBurn);
        expect(firstResult.cpuBurn).toBe('1');
        expect(firstResult.approveTxHash).toBe(APPROVE_HASH);
    });

    it('sends no value and approves nothing beyond the quote on a $CPU-only profile', async () => {
        const h = makeReveal({
            quote: { ethContributionWei: 0n, randomnessFeeWei: 0n, totalRequiredWei: 0n, cpuBurnWei: parseEther('2') },
            approve: APPROVE_HASH,
            bumpTo: 1,
        });

        const p = h.service.reveal('42');
        await vi.runAllTimersAsync();
        const result = await p;

        expect(h.cellClient.requests).toEqual([{ cell: CELL, tokenId: 42n, value: 0n }]);
        expect(h.allowance.calls).toEqual([{ token: CPU_TOKEN, spender: CELL, needed: parseEther('2') }]);
        expect(result.fee).toBe('0');
        expect(result.cpuBurn).toBe('2');
    });

    it('polls the map for the draw and reports fulfilled=false when it does not land in the window', async () => {
        const h = makeReveal({ bumpTo: null });

        const p = h.service.reveal('42');
        await vi.runAllTimersAsync();
        const result = await p;

        expect(result.fulfilled).toBe(false);
        expect(h.reader.refreshes).toBeGreaterThan(1);
    });

    it('refuses when the wallet chainId does not match the chain config', async () => {
        const h = makeReveal({ walletChainId: 8453 });
        await expect(h.service.reveal('42')).rejects.toThrow(/chain mismatch/i);
        expect(h.cellClient.requests).toHaveLength(0);
    });

    it('throws when the cell contract is not configured', async () => {
        const config = { ...makeConfig(), contracts: { ...makeConfig().contracts, cell: '' } };
        const h = makeReveal({ config });
        await expect(h.service.reveal('42')).rejects.toThrow(/cell contract is not configured/i);
    });

    it('throws when the cell is not in the map', async () => {
        const h = makeReveal({ state: null });
        await expect(h.service.reveal('42')).rejects.toThrow(/not in the current map/i);
    });

    it('throws when the wallet does not own the cell', async () => {
        const h = makeReveal({ state: revealState({ owner: '0x000000000000000000000000000000000000bEEF' }) });
        await expect(h.service.reveal('42')).rejects.toThrow(/do not own/i);
    });

    it('throws before requesting when $CPU is not configured but the quote asks for a burn', async () => {
        const config = { ...makeConfig(), contracts: { ...makeConfig().contracts, cpuToken: '' } };
        const h = makeReveal({
            config,
            quote: { ...DEFAULT_QUOTE, cpuBurnWei: parseEther('1') },
        });
        await expect(h.service.reveal('42')).rejects.toThrow(/not configured/i);
        expect(h.allowance.calls).toHaveLength(0);
        expect(h.cellClient.requests).toHaveLength(0);
    });

    it('throws when the request tx reverts on-chain', async () => {
        const h = makeReveal({ reverts: true });
        await expect(h.service.reveal('42')).rejects.toThrow(/reverted/i);
    });
});

const SELF_CELL = '0xcccccccccccccccccccccccccccccccccccccccc';
const SELF_CELL_ON_WIRE = getAddress(SELF_CELL);
const SELF_SOURCE = RANDOMNESS_ADAPTER.toLowerCase();
const SELF_SOURCE_ON_WIRE = getAddress(SELF_SOURCE);
const OTHER_ADDRESS = getAddress('0x00000000000000000000000000000000000000b2');
const GENESIS = 1_700_000_000;
const ROUND = 91n;
const REQUEST_ID = 7n;
const FEE = 1_000n;
const SELF_CONTRIBUTION = 5_000n;
const SIGNATURE = `0x${'ab'.repeat(64)}` as Hex;
const WAIT_UNTIL_RELEASE_SEC = 6;

interface Draw {
    resources: [number, number, number];
    amounts: [bigint, bigint, bigint];
    strengths: [number, number, number];
}

const DEFAULT_DRAW: Draw = { resources: [5, 6, 0], amounts: [100n, 200n, 0n], strengths: [3, 4, 0] };
const EMPTY_DRAW: Draw = { resources: [0, 0, 0], amounts: [0n, 0n, 0n], strengths: [0, 0, 0] };

function releaseOf(period: number, round: bigint): number {
    return GENESIS + Number(round - 1n) * period;
}

function signed(round: bigint): BeaconRoundResult {
    return { outcome: BeaconRoundOutcome.SIGNED, round, signature: SIGNATURE };
}

function silent(round: bigint): BeaconRoundResult {
    return { outcome: BeaconRoundOutcome.NOT_RELEASED, round, reason: `the beacon answered 404 for round ${round}` };
}

function malformed(round: bigint): BeaconRoundResult {
    return { outcome: BeaconRoundOutcome.MALFORMED, round, reason: 'expected 64 bytes of hex, got 96 characters' };
}

function log(address: Address, topics: unknown, data: Hex): Log {
    return {
        address,
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

function requestedLog(requestId: bigint, source: Address, tokenId: bigint = 42n): Log {
    return log(
        SELF_CELL_ON_WIRE,
        encodeEventTopics({ abi: CELL_ABI, eventName: 'RevealRequested', args: { tokenId, source } }),
        encodeAbiParameters(
            [{ type: 'uint64' }, { type: 'bool' }, { type: 'uint32' }, { type: 'uint64' }],
            [requestId, true, 1, BigInt(GENESIS)],
        ),
    );
}

function fulfilledLog(requestId: bigint, draw: Draw): Log {
    return log(
        SELF_CELL_ON_WIRE,
        encodeEventTopics({
            abi: CELL_ABI,
            eventName: 'RevealFulfilled',
            args: { tokenId: 42n, source: SELF_SOURCE_ON_WIRE },
        }),
        encodeAbiParameters(
            [
                { type: 'uint64' },
                { type: 'uint32' },
                { type: 'uint16[3]' },
                { type: 'uint64[3]' },
                { type: 'uint8[3]' },
            ],
            [requestId, 1, draw.resources, draw.amounts, draw.strengths],
        ),
    );
}

function revealAlreadyPending(): Error {
    const data = encodeErrorResult({ abi: CELL_ABI, errorName: 'RevealAlreadyPending' });
    return new Error('Execution reverted', { cause: { data } });
}

function adapterRevert(errorName: 'UnknownRequest', args: ReadonlyArray<unknown>): Error {
    const data = encodeErrorResult({ abi: RANDOMNESS_ADAPTER_ABI, errorName, args } as Parameters<
        typeof encodeErrorResult
    >[0]);
    return new Error('Execution reverted', { cause: { data } });
}

class ScriptedBeacon implements IBeaconClient {
    public readonly askedAt: Array<number> = [];
    public readonly askedFor: Array<bigint> = [];
    constructor(private readonly answers: Array<BeaconRoundResult>) {}
    async signatureOf(round: bigint): Promise<BeaconRoundResult> {
        const answer = this.answers[this.askedAt.length] ?? this.answers.at(-1) ?? silent(round);
        this.askedAt.push(Date.now());
        this.askedFor.push(round);
        return answer;
    }
}

class ScriptedRevealRequests implements IRevealRequestsReader {
    public readonly owners: Array<string> = [];
    constructor(
        private readonly requests: Array<OpenRevealRequestView>,
        private readonly serverTime: number,
    ) {}
    async listOpenRequests(owner: string): Promise<OpenRevealRequestsView> {
        this.owners.push(owner);
        return { serverTime: this.serverTime, requests: this.requests };
    }
}

class ScriptedWallet implements WalletManager, WalletProvider {
    public readonly sent: Array<TransactionRequest> = [];
    public readonly estimated: Array<GasEstimateRequest> = [];
    constructor(
        private readonly reads: Record<string, unknown>,
        private readonly receiptLogs: Array<Array<Log>>,
        private readonly gasEstimates: Array<bigint>,
        private readonly sendErrors: Array<unknown>,
        private readonly estimateErrors: Array<unknown> = [],
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
        return 1;
    }
    async sendTransaction(tx: TransactionRequest): Promise<Hash> {
        const index = this.sent.length;
        this.sent.push(tx);
        const failure = this.sendErrors[index];
        if (failure !== undefined && failure !== null) {
            throw failure;
        }
        return `0x${(index + 1).toString(16).padStart(64, '0')}` as Hash;
    }
    async estimateGas(tx: GasEstimateRequest): Promise<bigint> {
        const index = this.estimated.length;
        this.estimated.push(tx);
        const failure = this.estimateErrors[index];
        if (failure !== undefined && failure !== null) {
            throw failure;
        }
        return this.gasEstimates[index] ?? this.gasEstimates.at(-1) ?? 100_000n;
    }
    async getGasPrice(): Promise<bigint> {
        return 7_000_000_000n;
    }
    async waitForReceipt(hash: Hash): Promise<TxReceipt> {
        const index = Number(BigInt(hash)) - 1;
        return {
            status: TxStatus.Success,
            transactionHash: hash,
            blockNumber: BigInt(100 + index),
            logs: this.receiptLogs[index] ?? [],
        };
    }
    async readContract(params: ReadContractParams): Promise<unknown> {
        return this.reads[params.functionName];
    }
    async getBalance(): Promise<bigint> {
        return 0n;
    }
    async signMessage(): Promise<Hex> {
        return '0x';
    }
}

class ScriptedMapReader implements RevealCellReader {
    public refreshes = 0;
    public readonly refreshedAt: Array<number> = [];
    constructor(
        private state: Cell,
        private readonly serverTime: number,
        private readonly bumpTo: number | null,
        private readonly refreshError: Error | null = null,
    ) {}
    async readRevealCell(): Promise<Cell | null> {
        return this.state;
    }
    getServerTime(): number {
        return this.serverTime;
    }
    async refresh(): Promise<void> {
        this.refreshes += 1;
        this.refreshedAt.push(Date.now());
        if (this.refreshError !== null) {
            throw this.refreshError;
        }
        if (this.bumpTo !== null) {
            this.state = { ...this.state, revealCount: this.bumpTo };
        }
    }
}

class SingleStrategyFactory implements IRandomnessStrategyFactory {
    constructor(private readonly strategy: RandomnessStrategy) {}
    async create(): Promise<RandomnessStrategy> {
        return this.strategy;
    }
}

type SelfServiceOptions = Partial<{
    period: number;
    round: bigint;
    serverTime: number;
    pending: boolean;
    revealCount: number;
    cpuBurnWei: bigint;
    approve: Hash | null;
    beacon: Array<BeaconRoundResult>;
    openRequests: Array<OpenRevealRequestView>;
    consumer: Address;
    adapterRound: bigint;
    requestedId: bigint | null;
    requestedSource: Address;
    draw: Draw | null;
    gasEstimates: Array<bigint>;
    sendErrors: Array<unknown>;
    bumpTo: number | null;
    refreshError: Error | null;
    alreadyPending: boolean;
}>;

interface SelfServiceHarness {
    service: RevealService;
    wallet: ScriptedWallet;
    allowance: FakeAllowance;
    beacon: ScriptedBeacon;
    reader: ScriptedMapReader;
    revealRequests: ScriptedRevealRequests;
    claims: FulfilmentClaims;
}

function makeSelfService(opts: SelfServiceOptions = {}): SelfServiceHarness {
    const period = opts.period ?? 3;
    const round = opts.round ?? ROUND;
    const serverTime = opts.serverTime ?? releaseOf(period, round) - WAIT_UNTIL_RELEASE_SEC;
    const pending = opts.pending ?? false;
    const requestedId = opts.requestedId === undefined ? REQUEST_ID : opts.requestedId;
    const draw = opts.draw === undefined ? DEFAULT_DRAW : opts.draw;

    const alreadyPending = opts.alreadyPending ?? false;
    const requestLogs =
        requestedId === null ? [] : [requestedLog(requestedId, opts.requestedSource ?? SELF_SOURCE_ON_WIRE)];
    const fulfilLogs = draw === null ? [] : [fulfilledLog(REQUEST_ID, draw)];
    const receiptLogs = pending || alreadyPending ? [fulfilLogs] : [requestLogs, fulfilLogs];

    const cpuBurnWei = opts.cpuBurnWei ?? 0n;
    const wallet = new ScriptedWallet(
        {
            quoteReveal: [SELF_CONTRIBUTION, FEE, SELF_CONTRIBUTION + FEE, cpuBurnWei],
            requestOf: [opts.consumer ?? SELF_CELL_ON_WIRE, opts.adapterRound ?? round],
        },
        receiptLogs,
        opts.gasEstimates ?? [100_000n, 400_000n],
        opts.sendErrors ?? [],
        alreadyPending ? [revealAlreadyPending()] : [],
    );
    const contracts = new ContractClient({
        wallet,
        logger: new NoopLogger(),
        retry: { baseDelayMs: 0, maxDelayMs: 0 },
    });
    const beacon = new ScriptedBeacon(opts.beacon ?? [signed(round)]);
    const revealRequests = new ScriptedRevealRequests(
        opts.openRequests ?? [
            {
                requestId: REQUEST_ID.toString(),
                source: SELF_SOURCE_ON_WIRE,
                tokenId: '42',
                requestedAt: serverTime - 3,
            },
        ],
        serverTime,
    );
    const strategy = new DrandRandomnessStrategy({
        source: SELF_SOURCE as Address,
        clock: { genesis: GENESIS, period },
        beacon,
        contracts,
        revealRequests,
        logger: new NoopLogger(),
    });

    const base = makeConfig();
    const config: AppConfig = {
        ...base,
        contracts: { ...base.contracts, cell: SELF_CELL },
        randomness: {
            kind: RandomnessKind.DRAND,
            adapter: SELF_SOURCE,
            genesis: GENESIS,
            period,
            beaconApi: 'https://beacon.example/v2',
        },
        reveal: { ethContribution: SELF_CONTRIBUTION.toString(), cpuBurn: cpuBurnWei.toString() },
    };

    const allowance = new FakeAllowance(opts.approve ?? null);
    const reader = new ScriptedMapReader(
        revealState({ revealCount: opts.revealCount ?? 0, revealPending: pending } as Partial<Cell>),
        serverTime,
        opts.bumpTo ?? null,
        opts.refreshError ?? null,
    );
    const claims = new FulfilmentClaims();
    const service = new RevealService({
        wallet,
        appConfig: new FakeAppConfig(config),
        allowance,
        cellClient: new CellClient({ contracts, logger: new NoopLogger() }),
        contracts,
        randomness: new SingleStrategyFactory(strategy),
        claims,
        mapReader: reader,
        logger: new NoopLogger(),
    });
    return { service, wallet, allowance, beacon, reader, revealRequests, claims };
}

async function runReveal(h: SelfServiceHarness): Promise<Awaited<ReturnType<RevealService['reveal']>>> {
    const pending = h.service.reveal('42');
    await vi.runAllTimersAsync();
    return pending;
}

describe('RevealService on a self-service randomness source', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });
    afterEach(() => {
        vi.useRealTimers();
    });

    it('requests, signs and settles in one call, reading the drawn deposits out of the fulfilment receipt', async () => {
        const h = makeSelfService({ bumpTo: null });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(true);
        expect(result.requestTxHash).not.toBeNull();
        expect(result.fulfillTxHash).not.toBeNull();
        expect(result.requestId).toBe('7');
        expect(result.source).toBe(SELF_SOURCE_ON_WIRE);
        expect(result.round).toBe('91');
        expect(result.deposits).toEqual([
            { resourceId: 5, resourceName: 'Iron', amount: '100', strength: 3 },
            { resourceId: 6, resourceName: 'Copper', amount: '200', strength: 4 },
        ]);
        expect(result.note).toBeNull();
        expect(h.wallet.sent).toHaveLength(2);
    });

    it('reports the draw without the map projection ever catching up', async () => {
        const h = makeSelfService({ bumpTo: null });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(true);
        expect(result.deposits).toHaveLength(2);
        expect(h.reader.refreshes).toBe(3);
    });

    it('covers the total the cell quoted and carries headroom over it', async () => {
        const h = makeSelfService();

        await runReveal(h);

        const value = h.wallet.sent[0]?.value ?? 0n;
        expect(value).toBeGreaterThanOrEqual(SELF_CONTRIBUTION + FEE);
        expect(value).toBe(7_500n);
    });

    it('tells an empty draw apart from a draw it could not read', async () => {
        const empty = await runReveal(makeSelfService({ draw: EMPTY_DRAW }));
        const unseen = await runReveal(makeSelfService({ draw: null }));

        expect(empty.fulfilled).toBe(true);
        expect(empty.deposits).toEqual([]);
        expect(unseen.fulfilled).toBe(true);
        expect(unseen.deposits).toBeNull();
    });

    it('answers fulfilled=false with the request id, the source and the round when the beacon stays silent', async () => {
        const h = makeSelfService({ beacon: [silent(ROUND)] });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(false);
        expect(result.requestId).toBe('7');
        expect(result.source).toBe(SELF_SOURCE_ON_WIRE);
        expect(result.round).toBe('91');
        expect(result.fulfillTxHash).toBeNull();
        expect(result.deposits).toBeNull();
        expect(result.note).toMatch(/round 91 was still unpublished/i);
        expect(result.note).toMatch(/call reveal on cell 42 again/i);
    });

    it('answers fulfilled=false when the beacon signs in a scheme this client cannot fulfil with', async () => {
        const result = await runReveal(makeSelfService({ beacon: [malformed(ROUND)] }));

        expect(result.fulfilled).toBe(false);
        expect(result.round).toBe('91');
        expect(result.note).toMatch(/shape this client cannot fulfil with/i);
    });

    it('budgets the wait off the map server clock, so a local clock years off does not shrink it', async () => {
        vi.setSystemTime(new Date('2031-03-01T00:00:00Z'));
        const h = makeSelfService({ beacon: [silent(ROUND)] });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(false);
        expect(h.beacon.askedAt).toHaveLength(5);
    });

    it('clamps the wait between one step and the ceiling the client already grants a reveal', async () => {
        const lapsed = makeSelfService({ beacon: [silent(ROUND)], serverTime: releaseOf(3, ROUND) + 600 });
        const distant = makeSelfService({ beacon: [silent(ROUND)], serverTime: releaseOf(3, ROUND) - 600 });

        await runReveal(lapsed);
        await runReveal(distant);

        expect(lapsed.beacon.askedAt).toHaveLength(2);
        expect(distant.beacon.askedAt).toHaveLength(16);
    });

    it('spends the whole wait it budgets, so the floored budget still buys a second look', async () => {
        const lapsed = makeSelfService({ beacon: [silent(ROUND)], serverTime: releaseOf(3, ROUND) + 600 });

        await runReveal(lapsed);

        expect(lapsed.beacon.askedAt).toHaveLength(2);
        expect(lapsed.beacon.askedAt.map((at) => at - (lapsed.beacon.askedAt[0] ?? 0))).toEqual([0, 3_000]);
    });

    it('takes a second look at the round when settling the request the cell already carries', async () => {
        const h = makeSelfService({
            pending: true,
            beacon: [silent(ROUND)],
            serverTime: releaseOf(3, ROUND) + 60,
        });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(false);
        expect(h.beacon.askedAt).toHaveLength(2);
    });

    it('takes a second look on a slow beacon period too, when the round it needs is long released', async () => {
        const h = makeSelfService({
            period: 30,
            pending: true,
            beacon: [silent(ROUND)],
            serverTime: releaseOf(30, ROUND) + 300,
        });

        await runReveal(h);

        expect(h.beacon.askedAt).toHaveLength(2);
    });

    it.each([[3], [30]])('steps every three seconds on a %i second beacon period', async (period) => {
        const h = makeSelfService({ period, beacon: [silent(ROUND)] });

        await runReveal(h);

        expect(h.beacon.askedAt).toHaveLength(5);
        const steps = h.beacon.askedAt.slice(1).map((at, index) => at - (h.beacon.askedAt[index] ?? 0));
        expect(steps).toEqual([3_000, 3_000, 3_000, 3_000]);
    });

    it('asks for and fulfils with the round the source reports, never one read off the request', async () => {
        const h = makeSelfService({ adapterRound: 555n });

        const result = await runReveal(h);

        expect(h.beacon.askedFor).toEqual([555n]);
        expect(result.round).toBe('555');
        expect(decodeFunctionData({ abi: RANDOMNESS_ADAPTER_ABI, data: h.wallet.sent[1]?.data ?? '0x' })).toEqual({
            functionName: 'fulfillReveal',
            args: [REQUEST_ID, 555n, SIGNATURE],
        });
    });

    it('stops asking as soon as the beacon publishes the round', async () => {
        const h = makeSelfService({ beacon: [silent(ROUND), silent(ROUND), signed(ROUND)] });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(true);
        expect(h.beacon.askedAt).toHaveLength(3);
    });

    it('settles the request the cell already carries without requesting again or paying again', async () => {
        const h = makeSelfService({
            pending: true,
            revealCount: 1,
            cpuBurnWei: parseEther('1'),
            approve: APPROVE_HASH,
        });

        const result = await runReveal(h);

        expect(result.requestTxHash).toBeNull();
        expect(result.fee).toBe('0');
        expect(result.cpuBurn).toBe('0');
        expect(result.approveTxHash).toBeNull();
        expect(h.allowance.calls).toHaveLength(0);
        expect(h.wallet.sent).toHaveLength(1);
        expect(result.fulfilled).toBe(true);
        expect(result.requestId).toBe('7');
        expect(result.deposits).toHaveLength(2);
        expect(h.revealRequests.owners).toEqual([WALLET_ADDRESS]);
    });

    it('settles the open request when the chain refuses a second one the map has not caught up with', async () => {
        const h = makeSelfService({
            alreadyPending: true,
            revealCount: 1,
            cpuBurnWei: parseEther('1'),
            approve: APPROVE_HASH,
        });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(true);
        expect(result.requestId).toBe('7');
        expect(result.deposits).toHaveLength(2);
        expect(result.requestTxHash).toBeNull();
        expect(result.fee).toBe('0');
        expect(result.cpuBurn).toBe('0');
        expect(result.approveTxHash).toBe(APPROVE_HASH);
        expect(h.wallet.sent).toHaveLength(1);
        expect(h.revealRequests.owners).toEqual([WALLET_ADDRESS]);
    });

    it('lets a revert that is not an open request through instead of settling something else', async () => {
        const h = makeSelfService({ gasEstimates: [], sendErrors: [new Error('insufficient funds')] });

        await expect(h.service.reveal('42')).rejects.toThrow(/insufficient funds/i);
    });

    it('refreshes the map after a settlement that did not finish, and stops once it shows the open request', async () => {
        const lagging = makeSelfService({ beacon: [silent(ROUND)] });
        const current = makeSelfService({ pending: true, beacon: [silent(ROUND)] });

        const laggingResult = await runReveal(lagging);
        const currentResult = await runReveal(current);

        expect(laggingResult.fulfilled).toBe(false);
        expect(currentResult.fulfilled).toBe(false);
        expect(lagging.reader.refreshes).toBe(3);
        expect(current.reader.refreshes).toBe(1);
    });

    it('explains a pending reveal the game API does not list yet and names both ways out', async () => {
        const h = makeSelfService({ pending: true, openRequests: [] });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(false);
        expect(result.requestTxHash).toBeNull();
        expect(result.requestId).toBeNull();
        expect(h.wallet.sent).toHaveLength(0);
        expect(result.note).toMatch(/does not list that request yet/i);
        expect(result.note).toMatch(/call reveal on cell 42 again/i);
        expect(result.note).toMatch(/get_cell 42/i);
    });

    it('names the retired source and the admin cleanup for an open request the API lists at another source', async () => {
        const h = makeSelfService({
            pending: true,
            openRequests: [{ requestId: '9', source: OTHER_ADDRESS, tokenId: '42', requestedAt: null }],
        });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(false);
        expect(result.note).toContain(OTHER_ADDRESS);
        expect(result.note).toContain(SELF_SOURCE);
        expect(result.note).toMatch(/admin cleanup is the only way out/i);
        expect(result.note).not.toMatch(/does not list that request yet/i);
        expect(result.note).not.toMatch(/call reveal on cell 42 again/i);
        expect(h.wallet.sent).toHaveLength(0);
        expect(h.beacon.askedAt).toHaveLength(0);
    });

    it('hands back the request of the retired source, not the source the chain config now names', async () => {
        const h = makeSelfService({
            pending: true,
            openRequests: [{ requestId: '9', source: OTHER_ADDRESS, tokenId: '42', requestedAt: null }],
        });

        const result = await runReveal(h);

        expect(result.requestId).toBe('9');
        expect(result.source).toBe(OTHER_ADDRESS);
    });

    it('tells a request listed at a retired source apart from one the game API does not list at all', async () => {
        const unlisted = makeSelfService({ pending: true, openRequests: [] });
        const retired = makeSelfService({
            pending: true,
            openRequests: [{ requestId: '9', source: OTHER_ADDRESS, tokenId: '42', requestedAt: null }],
        });

        const unlistedResult = await runReveal(unlisted);
        const retiredResult = await runReveal(retired);

        expect(unlistedResult.note).not.toBe(retiredResult.note);
        expect(unlistedResult.requestId).toBeNull();
        expect(unlistedResult.source).toBe(SELF_SOURCE);
        expect(retiredResult.requestId).toBe('9');
        expect(retiredResult.source).toBe(OTHER_ADDRESS);
    });

    it('keeps reading the request of the current source when the API lists both', async () => {
        const h = makeSelfService({
            pending: true,
            openRequests: [
                { requestId: '9', source: OTHER_ADDRESS, tokenId: '42', requestedAt: null },
                { requestId: '7', source: SELF_SOURCE_ON_WIRE, tokenId: '42', requestedAt: null },
            ],
        });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(true);
        expect(result.requestId).toBe('7');
        expect(result.source).toBe(SELF_SOURCE_ON_WIRE);
    });

    it('carries a gas limit half again above the estimate on both transactions', async () => {
        const h = makeSelfService({ gasEstimates: [100_000n, 400_000n] });

        await runReveal(h);

        expect(h.wallet.estimated).toHaveLength(2);
        expect(h.wallet.sent.map((tx) => tx.gas)).toEqual([150_000n, 600_000n]);
    });

    it('treats a request the source settled before this call as done, with no draw to report', async () => {
        const h = makeSelfService({ consumer: zeroAddress });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(true);
        expect(result.deposits).toBeNull();
        expect(result.fulfillTxHash).toBeNull();
        expect(h.wallet.sent).toHaveLength(1);
        expect(h.beacon.askedAt).toHaveLength(0);
    });

    it('treats a request the source no longer knows at fulfilment time as done', async () => {
        const h = makeSelfService({ sendErrors: [null, adapterRevert('UnknownRequest', [REQUEST_ID])] });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(true);
        expect(result.deposits).toBeNull();
        expect(result.fulfillTxHash).toBeNull();
    });

    it('refuses to settle a request the source holds for another consumer', async () => {
        const h = makeSelfService({ consumer: OTHER_ADDRESS });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(false);
        expect(result.note).toMatch(new RegExp(`is held for ${OTHER_ADDRESS}`, 'i'));
        expect(result.round).toBe('91');
        expect(h.wallet.sent).toHaveLength(1);
    });

    it('refuses to settle a request the cell opened at a source this client is not pointed at', async () => {
        const h = makeSelfService({ requestedSource: OTHER_ADDRESS });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(false);
        expect(result.note).toMatch(/opened reveal request 7 at randomness source/i);
        expect(h.beacon.askedAt).toHaveLength(0);
    });

    it('keeps the paid-for request recoverable when the receipt carries no request of its own', async () => {
        const h = makeSelfService({ requestedId: null });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(false);
        expect(result.requestId).toBeNull();
        expect(result.requestTxHash).not.toBeNull();
        expect(result.note).toMatch(/could not read its id back out of the receipt/i);
    });

    it('answers instead of throwing when the fulfilment itself is rejected', async () => {
        const h = makeSelfService({ sendErrors: [null, new Error('nonce too low')] });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(false);
        expect(result.requestId).toBe('7');
        expect(result.round).toBe('91');
        expect(result.note).toMatch(/nonce too low/i);
    });

    it('keeps the confirmed draw when the map refresh fails after the fulfilment, and says so in the note', async () => {
        const h = makeSelfService({ refreshError: new Error('map read failed with 503') });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(true);
        expect(result.fulfillTxHash).not.toBeNull();
        expect(result.requestId).toBe('7');
        expect(result.round).toBe('91');
        expect(result.deposits).toEqual([
            { resourceId: 5, resourceName: 'Iron', amount: '100', strength: 3 },
            { resourceId: 6, resourceName: 'Copper', amount: '200', strength: 4 },
        ]);
        expect(h.reader.refreshes).toBe(3);
        expect(result.note).toMatch(/map read failed with 503/);
        expect(result.note).not.toMatch(/stays open/i);
        expect(result.note).not.toMatch(/call reveal on cell 42 again/i);
    });

    it('keeps a request the source had already settled settled when the map refresh fails', async () => {
        const h = makeSelfService({ consumer: zeroAddress, refreshError: new Error('map read failed with 503') });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(true);
        expect(result.note).toMatch(/map read failed with 503/);
        expect(result.note).not.toMatch(/stays open/i);
    });

    it('primes the map after the draw lands and stops as soon as the projection catches up', async () => {
        const h = makeSelfService({ bumpTo: 1 });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(true);
        expect(h.reader.refreshes).toBe(1);
    });

    it('sends no second fulfilment for a request the background sweep is already settling, and says who has it', async () => {
        const h = makeSelfService({ pending: true });
        h.claims.claim(SELF_SOURCE_ON_WIRE, REQUEST_ID);

        const result = await runReveal(h);

        expect(h.wallet.sent).toHaveLength(0);
        expect(h.beacon.askedAt).toHaveLength(0);
        expect(result.fulfilled).toBe(false);
        expect(result.requestId).toBe('7');
        expect(result.note).toMatch(/reveal request 7 for cell 42 is already being settled by this client/i);
        expect(result.note).toMatch(/get_cell 42/i);
    });

    it('hands the request back after a settlement that did not finish, so the sweep can take it', async () => {
        const h = makeSelfService({ beacon: [silent(ROUND)] });

        const result = await runReveal(h);

        expect(result.fulfilled).toBe(false);
        expect(h.claims.has(SELF_SOURCE_ON_WIRE, REQUEST_ID)).toBe(false);
    });

    it('approves the quoted burn to the wei and covers the quoted total for a fresh request on a revealed cell', async () => {
        const h = makeSelfService({ revealCount: 1, cpuBurnWei: parseEther('1'), approve: APPROVE_HASH });

        const result = await runReveal(h);

        expect(h.allowance.calls).toEqual([{ token: CPU_TOKEN, spender: SELF_CELL, needed: parseEther('1') }]);
        expect(h.wallet.sent[0]?.value).toBe(7_500n);
        expect(result.genesis).toBe(false);
        expect(result.fee).toBe(formatEther(SELF_CONTRIBUTION + FEE));
        expect(result.cpuBurn).toBe('1');
        expect(result.approveTxHash).toBe(APPROVE_HASH);
    });
});
