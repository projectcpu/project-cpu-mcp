import {
    decodeFunctionData,
    encodeErrorResult,
    parseAbi,
    zeroAddress,
    type Abi,
    type Address,
    type Hash,
    type Hex,
} from 'viem';
import { describe, expect, it } from 'vitest';

import type { IRevealRequestsReader, OpenRevealRequestsView, OpenRevealRequestView } from '../../api/types.js';
import { RANDOMNESS_ADAPTER_ABI } from '../../contracts/randomness-adapter.abi.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type {
    ConfirmedTx,
    GasEstimateRequest,
    IContractClient,
    ReadContractParams,
    TransactionRequest,
    WalletManager,
    WalletProvider,
} from '../../wallet/types.js';
import { DrandRandomnessStrategy } from '../drand.strategy.js';
import { AdapterErrorName, AdapterRequestState, type BeaconRoundResult, type IBeaconClient } from '../types.js';

const SOURCE = '0xAbC1230000000000000000000000000000000001' as Address;
const RETIRED_SOURCE = '0x00000000000000000000000000000000000000b2' as Address;
const CELL = '0x1111111111111111111111111111111111111111' as Address;
const OWNER = '0x000000000000000000000000000000000000dEaD' as Address;
const FULFILL_HASH = `0x${'f'.repeat(64)}` as Hash;
const SIGNATURE = `0x${'ab'.repeat(64)}` as Hex;
const SERVER_TIME = 1_700_000_100;

const DEPLOYED_ERRORS = parseAbi([
    'error UnknownRequest(uint64 requestId)',
    'error RoundMismatch(uint64 requestId, uint64 expected, uint64 provided)',
    'error MalformedSignature()',
    'error SignatureDoesNotVerify(uint64 round)',
    'error InsufficientCallbackGas(uint256 budget, uint256 available)',
    'error InsufficientFee(uint256 quoted, uint256 attached)',
]);

class FakeContracts implements IContractClient {
    public readonly reads: Array<ReadContractParams> = [];
    public readonly sent: Array<TransactionRequest> = [];
    public readonly estimates: Array<GasEstimateRequest> = [];
    constructor(
        private readonly results: Record<string, unknown> = {},
        private readonly sendError: unknown = null,
        private readonly gasEstimate: bigint = 400_000n,
    ) {}
    async read<T>(params: ReadContractParams): Promise<T> {
        this.reads.push(params);
        return this.results[params.functionName] as T;
    }
    async estimateGas(tx: GasEstimateRequest): Promise<bigint> {
        this.estimates.push(tx);
        return this.gasEstimate;
    }
    async send(tx: TransactionRequest, _errorAbi: Abi | null): Promise<Hash> {
        this.sent.push(tx);
        if (this.sendError !== null) {
            throw this.sendError;
        }
        return FULFILL_HASH;
    }
    async confirm(): Promise<ConfirmedTx> {
        throw new Error('unused');
    }
}

class FakeRevealRequests implements IRevealRequestsReader {
    public readonly owners: Array<string> = [];
    constructor(private readonly requests: Array<OpenRevealRequestView> = []) {}
    async listOpenRequests(owner: string): Promise<OpenRevealRequestsView> {
        this.owners.push(owner);
        return { serverTime: SERVER_TIME, requests: this.requests };
    }
}

class SilentBeacon implements IBeaconClient {
    async signatureOf(): Promise<BeaconRoundResult> {
        throw new Error('unused');
    }
}

class FakeWallet implements WalletProvider {
    public gasPriceReads = 0;
    public gasEstimates = 0;
    constructor(private readonly gasPrices: Array<bigint> = [1_000_000_000n]) {}
    get(): WalletManager {
        return {
            getGasPrice: async (): Promise<bigint> => {
                const price = this.gasPrices[this.gasPriceReads] ?? this.gasPrices.at(-1) ?? 0n;
                this.gasPriceReads += 1;
                return price;
            },
            estimateGas: async (): Promise<bigint> => {
                this.gasEstimates += 1;
                return 400_000n;
            },
        } as unknown as WalletManager;
    }
    isReady(): boolean {
        return true;
    }
}

type StrategyOptions = Partial<{
    results: Record<string, unknown>;
    sendError: unknown;
    requests: Array<OpenRevealRequestView>;
    gasPrices: Array<bigint>;
    gasEstimate: bigint;
}>;

function makeStrategy(options: StrategyOptions): {
    strategy: DrandRandomnessStrategy;
    contracts: FakeContracts;
    revealRequests: FakeRevealRequests;
    wallet: FakeWallet;
} {
    const contracts = new FakeContracts(
        options.results ?? {},
        options.sendError ?? null,
        options.gasEstimate ?? 400_000n,
    );
    const revealRequests = new FakeRevealRequests(options.requests ?? []);
    const wallet = new FakeWallet(options.gasPrices ?? [1_000_000_000n]);
    const strategy = new DrandRandomnessStrategy({
        source: SOURCE,
        clock: { genesis: 1_700_000_000, period: 3 },
        beacon: new SilentBeacon(),
        contracts,
        revealRequests,
        logger: new NoopLogger(),
    });
    return { strategy, contracts, revealRequests, wallet };
}

function requestRow(over: Partial<OpenRevealRequestView> = {}): OpenRevealRequestView {
    return { requestId: '7', source: SOURCE.toLowerCase(), tokenId: '42', requestedAt: 1_700_000_050, ...over };
}

function revertWith(errorName: string, args: ReadonlyArray<unknown>): { data: string } {
    return {
        data: encodeErrorResult({
            abi: DEPLOYED_ERRORS,
            errorName,
            ...(args.length > 0 ? { args } : {}),
        } as Parameters<typeof encodeErrorResult>[0]),
    };
}

function sentCall(tx: TransactionRequest): { functionName: string; args: ReadonlyArray<unknown> } {
    const decoded = decodeFunctionData({ abi: RANDOMNESS_ADAPTER_ABI, data: tx.data });
    return { functionName: decoded.functionName, args: decoded.args ?? [] };
}

describe('DrandRandomnessStrategy', () => {
    it('prices no part of a reveal, leaving the whole price to the Cell that charges it', async () => {
        const { strategy, contracts, wallet } = makeStrategy({ results: { quoteFeeAt: 4_200n } });

        expect('quoteRequestFee' in strategy).toBe(false);
        expect('quoteFee' in strategy).toBe(false);
        expect(contracts.reads).toHaveLength(0);
        expect(wallet.gasPriceReads).toBe(0);
    });

    it('reads an open request at the adapter and reports the round it targets', async () => {
        const { strategy, contracts } = makeStrategy({ results: { requestOf: [CELL, 91n] } });

        const view = await strategy.readRequest(7n);

        expect(view).toEqual({
            state: AdapterRequestState.OPEN,
            requestId: 7n,
            consumer: CELL,
            round: 91n,
        });
        expect(contracts.reads).toEqual([
            { address: SOURCE, abi: RANDOMNESS_ADAPTER_ABI, functionName: 'requestOf', args: [7n] },
        ]);
    });

    it('reads a settled request as closed', async () => {
        const { strategy } = makeStrategy({ results: { requestOf: [zeroAddress, 0n] } });

        const view = await strategy.readRequest(7n);

        expect(view.state).toBe(AdapterRequestState.CLOSED);
        expect(view.round).toBe(0n);
    });

    it('reads the same view at the adapter whether the id came from the chain or from the open-request list', async () => {
        const inline = makeStrategy({ results: { requestOf: [CELL, 91n] } });
        const sweep = makeStrategy({ results: { requestOf: [CELL, 91n] }, requests: [requestRow()] });

        const inlineView = await inline.strategy.readRequest(7n);
        const found = await sweep.strategy.findOpenRequest(OWNER, '42');
        const sweepView = await sweep.strategy.readRequest(found?.requestId ?? 0n);

        expect(sweepView).toEqual(inlineView);
        expect(sweep.contracts.reads.at(-1)).toEqual(inline.contracts.reads.at(-1));
    });

    it('scopes the open-request lookup to the owner it was handed', async () => {
        const { strategy, revealRequests } = makeStrategy({ requests: [requestRow()] });

        await strategy.findOpenRequest(OWNER, '42');

        expect(revealRequests.owners).toEqual([OWNER]);
    });

    it('finds the cell request when the wire address and the adapter differ in case', async () => {
        const { strategy } = makeStrategy({ requests: [requestRow({ source: SOURCE.toLowerCase() })] });

        const found = await strategy.findOpenRequest(OWNER, '42');

        expect(found?.requestId).toBe(7n);
        expect(found?.serverTime).toBe(SERVER_TIME);
        expect(found?.requestedAt).toBe(1_700_000_050);
    });

    it('ignores requests opened at a retired source and requests for other cells', async () => {
        const { strategy } = makeStrategy({
            requests: [requestRow({ source: RETIRED_SOURCE }), requestRow({ requestId: '8', tokenId: '43' })],
        });

        expect(await strategy.findOpenRequest(OWNER, '42')).toBeNull();
    });

    it('finds the request the cell opened at a source the chain config has replaced', async () => {
        const { strategy, revealRequests } = makeStrategy({
            requests: [requestRow({ requestId: '9', source: RETIRED_SOURCE })],
        });

        const found = await strategy.findRetiredSourceRequest(OWNER, '42');

        expect(found?.requestId).toBe(9n);
        expect(found?.source).toBe(RETIRED_SOURCE);
        expect(found?.serverTime).toBe(SERVER_TIME);
        expect(revealRequests.owners).toEqual([OWNER]);
    });

    it('reports no retired-source request when the cell request stands at the current source', async () => {
        const { strategy } = makeStrategy({ requests: [requestRow(), requestRow({ requestId: '8', tokenId: '43' })] });

        expect(await strategy.findRetiredSourceRequest(OWNER, '42')).toBeNull();
    });

    it('sends the fulfilment to the adapter carrying the id, the round and the signature', async () => {
        const { strategy, contracts } = makeStrategy({});

        const result = await strategy.fulfill({ requestId: 7n, round: 91n, signature: SIGNATURE });

        expect(result).toEqual({
            state: AdapterRequestState.OPEN,
            requestId: 7n,
            round: 91n,
            txHash: FULFILL_HASH,
        });
        expect(contracts.sent).toHaveLength(1);
        expect(contracts.sent[0]?.to).toBe(SOURCE);
        expect(contracts.sent[0]?.value).toBeNull();
        expect(sentCall(contracts.sent[0] as TransactionRequest)).toEqual({
            functionName: 'fulfillReveal',
            args: [7n, 91n, SIGNATURE],
        });
    });

    it('carries a gas limit half again above the estimate, which the callback budget rule needs', async () => {
        const { strategy, contracts } = makeStrategy({ gasEstimate: 400_000n });

        await strategy.fulfill({ requestId: 7n, round: 91n, signature: SIGNATURE });

        expect(contracts.sent[0]?.gas).toBe(600_000n);
        expect(contracts.estimates).toEqual([{ to: SOURCE, data: contracts.sent[0]?.data, value: null }]);
    });

    it('fulfils with the round the adapter reported, never one taken from elsewhere', async () => {
        const { strategy, contracts } = makeStrategy({
            results: { requestOf: [CELL, 91n] },
            requests: [requestRow()],
        });

        const found = await strategy.findOpenRequest(OWNER, '42');
        const view = await strategy.readRequest(found?.requestId ?? 0n);
        await strategy.fulfill({ requestId: view.requestId, round: view.round, signature: SIGNATURE });

        expect(sentCall(contracts.sent[0] as TransactionRequest).args).toEqual([7n, 91n, SIGNATURE]);
    });

    it('treats a request the adapter no longer knows as already done, not as a failure', async () => {
        const { strategy } = makeStrategy({ sendError: revertWith('UnknownRequest', [7n]) });

        const result = await strategy.fulfill({ requestId: 7n, round: 91n, signature: SIGNATURE });

        expect(result.state).toBe(AdapterRequestState.CLOSED);
        expect(result).toMatchObject({ requestId: 7n, round: 91n });
        expect(result.state === AdapterRequestState.CLOSED ? result.reason : '').toMatch(/already been fulfilled/i);
    });

    it.each([
        ['RoundMismatch', [7n, 91n, 90n], /beacon handed back round 90/i],
        ['MalformedSignature', [], /64-byte signatures/i],
        ['SignatureDoesNotVerify', [91n], /signature of round 91/i],
        ['InsufficientCallbackGas', [550_000n, 356_850n], /higher gas limit/i],
        ['InsufficientFee', [1_500n, 1_000n], /quote again and retry/i],
    ])('explains a %s revert in plain words', async (errorName, args, phrase) => {
        const { strategy } = makeStrategy({ sendError: revertWith(errorName as string, args as Array<unknown>) });

        await expect(strategy.fulfill({ requestId: 7n, round: 91n, signature: SIGNATURE })).rejects.toThrow(
            phrase as RegExp,
        );
    });

    it('names no raw error identifier in what the agent reads', async () => {
        const { strategy } = makeStrategy({ sendError: revertWith('RoundMismatch', [7n, 91n, 90n]) });

        await expect(strategy.fulfill({ requestId: 7n, round: 91n, signature: SIGNATURE })).rejects.not.toThrow(
            new RegExp(AdapterErrorName.ROUND_MISMATCH),
        );
    });

    it('passes a revert it has no phrase for through untouched', async () => {
        const sendError = new Error('nonce too low');
        const { strategy } = makeStrategy({ sendError });

        await expect(strategy.fulfill({ requestId: 7n, round: 91n, signature: SIGNATURE })).rejects.toThrow(
            'nonce too low',
        );
    });
});
