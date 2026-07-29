import { type Abi, decodeFunctionData, encodeErrorResult, parseAbi, type Address, type Hash } from 'viem';
import { describe, expect, it } from 'vitest';

import { CELL_ABI } from '../../contracts/cell.abi.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { describeRevert } from '../../wallet/revert.utils.js';
import type {
    ConfirmedTx,
    GasEstimateRequest,
    IContractClient,
    ReadContractParams,
    TransactionRequest,
} from '../../wallet/types.js';
import { CellClient } from '../cell.client.js';

const CELL = '0x1111111111111111111111111111111111111111' as Address;
const SENT = `0x${'f'.repeat(64)}` as Hash;

const REVEAL_ALREADY_PENDING = encodeErrorResult({ abi: CELL_ABI, errorName: 'RevealAlreadyPending' });
const DEPOSITS_NOT_EXHAUSTED = encodeErrorResult({ abi: CELL_ABI, errorName: 'DepositsNotExhausted' });
const REVEAL_CELL_OCCUPIED = encodeErrorResult({ abi: CELL_ABI, errorName: 'RevealCellOccupied' });
const REVEAL_PROCESS_ACTIVE = encodeErrorResult({ abi: CELL_ABI, errorName: 'RevealProcessActive' });
const REVEAL_NOT_CONFIGURED = encodeErrorResult({ abi: CELL_ABI, errorName: 'RevealNotConfigured' });

class FakeContracts implements IContractClient {
    public readonly sent: Array<TransactionRequest> = [];
    public readonly estimates: Array<GasEstimateRequest> = [];
    constructor(
        private readonly reads: Record<string, unknown>,
        private readonly sendError: unknown = null,
        private readonly gasEstimate: bigint = 200_000n,
        private readonly estimateError: unknown = null,
    ) {}
    async read<T>(params: ReadContractParams): Promise<T> {
        return this.reads[params.functionName] as T;
    }
    async estimateGas(tx: GasEstimateRequest): Promise<bigint> {
        this.estimates.push(tx);
        if (this.estimateError !== null) {
            throw this.estimateError;
        }
        return this.gasEstimate;
    }
    async send(tx: TransactionRequest, _errorAbi: Abi | null): Promise<Hash> {
        this.sent.push(tx);
        if (this.sendError !== null) {
            throw this.sendError;
        }
        return SENT;
    }
    async confirm(): Promise<ConfirmedTx> {
        throw new Error('unused');
    }
}

function makeClient(
    reads: Record<string, unknown>,
    sendError: unknown = null,
    gasEstimate: bigint = 200_000n,
    estimateError: unknown = null,
): { client: CellClient; contracts: FakeContracts } {
    const contracts = new FakeContracts(reads, sendError, gasEstimate, estimateError);
    return { client: new CellClient({ contracts, logger: new NoopLogger() }), contracts };
}

describe('CellClient', () => {
    it('encodes requestReveal and sends it with the fee value', async () => {
        const { client, contracts } = makeClient({});
        const hash = await client.requestReveal({ cell: CELL, tokenId: 42n, value: 5n });

        expect(hash).toBe(SENT);
        const tx = contracts.sent[0];
        if (tx === undefined) {
            throw new Error('expected a tx');
        }
        expect(tx.to).toBe(CELL);
        expect(tx.value).toBe(5n);
        const decoded = decodeFunctionData({ abi: CELL_ABI, data: tx.data });
        expect(decoded.functionName).toBe('requestReveal');
        expect(decoded.args).toEqual([42n]);
    });

    it('carries a gas limit half again above the estimate of the very call it sends', async () => {
        const { client, contracts } = makeClient({}, null, 200_000n);

        await client.requestReveal({ cell: CELL, tokenId: 42n, value: 5n });

        expect(contracts.sent[0]?.gas).toBe(300_000n);
        expect(contracts.estimates).toEqual([{ to: CELL, data: contracts.sent[0]?.data, value: 5n }]);
    });

    it.each([
        ['RevealAlreadyPending', REVEAL_ALREADY_PENDING, /cell 42 already has a reveal request waiting/is],
        ['DepositsNotExhausted', DEPOSITS_NOT_EXHAUSTED, /cell 42 still holds deposits.*mined out/is],
        ['RevealCellOccupied', REVEAL_CELL_OCCUPIED, /cell 42 has a building on it.*demolish/is],
        ['RevealProcessActive', REVEAL_PROCESS_ACTIVE, /cell 42 is running a mining or craft process/is],
        ['RevealNotConfigured', REVEAL_NOT_CONFIGURED, /no reveal draw configured/is],
    ])('explains a %s revert of the cell in plain words, naming the cell', async (_name, data, phrase) => {
        const { client } = makeClient({}, new Error('Execution reverted', { cause: { data } }));

        await expect(client.requestReveal({ cell: CELL, tokenId: 42n, value: 1_000n })).rejects.toThrow(phrase);
    });

    it('explains a reused request id, naming the id the source handed back', async () => {
        const data = encodeErrorResult({ abi: CELL_ABI, errorName: 'RevealRequestIdInUse', args: [7n] });
        const { client } = makeClient({}, new Error('Execution reverted', { cause: { data } }));

        await expect(client.requestReveal({ cell: CELL, tokenId: 42n, value: 1_000n })).rejects.toThrow(
            /request id 7.*already holds/is,
        );
    });

    it('phrases a revert the estimate raises before anything is sent', async () => {
        const { client, contracts } = makeClient(
            {},
            null,
            0n,
            new Error('Execution reverted', { cause: { data: REVEAL_ALREADY_PENDING } }),
        );

        await expect(client.requestReveal({ cell: CELL, tokenId: 42n, value: 1_000n })).rejects.toThrow(
            /already has a reveal request waiting/i,
        );
        expect(contracts.sent).toHaveLength(0);
    });

    it('explains an underpaid reveal request in plain words instead of leaving a bare selector', async () => {
        const data = encodeErrorResult({
            abi: parseAbi(['error InsufficientRevealFee()']),
            errorName: 'InsufficientRevealFee',
        });
        const { client } = makeClient({}, new Error('Execution reverted', { cause: { data } }));

        await expect(client.requestReveal({ cell: CELL, tokenId: 42n, value: 1_000n })).rejects.toThrow(
            /reveal fee moved between the quote and the send.*quote again and retry/is,
        );
    });

    it('names the reveal fee revert of the cell, which no abi decoded before', () => {
        const data = encodeErrorResult({
            abi: parseAbi(['error InsufficientRevealFee()']),
            errorName: 'InsufficientRevealFee',
        });

        expect(describeRevert({ data }, CELL_ABI)).toBe('InsufficientRevealFee()');
    });

    it('phrases a randomness-source fee revert, which the current chain never raises through the request', async () => {
        const data = encodeErrorResult({
            abi: parseAbi(['error InsufficientFee(uint256 quoted, uint256 attached)']),
            errorName: 'InsufficientFee',
            args: [1_500n, 1_000n],
        });
        const { client } = makeClient({}, new Error('Execution reverted', { cause: { data } }));

        await expect(client.requestReveal({ cell: CELL, tokenId: 42n, value: 1_000n })).rejects.toThrow(
            /now asks 1500 wei.*carried 1000.*quote again and retry/is,
        );
    });

    it('phrases the pending-request revert so it holds where the source delivers the draw itself too', async () => {
        const { client } = makeClient({}, new Error('Execution reverted', { cause: { data: REVEAL_ALREADY_PENDING } }));

        await expect(client.requestReveal({ cell: CELL, tokenId: 42n, value: 1_000n })).rejects.toThrow(
            /delivers the draw itself.*get_cell 42.*delivery is left to you.*get_game_config/is,
        );
    });

    it('explains the reveal request that blocks a build in plain words instead of leaving a bare selector', async () => {
        const data = encodeErrorResult({
            abi: parseAbi(['error RevealInFlight()']),
            errorName: 'RevealInFlight',
        });
        const { client } = makeClient({}, new Error('Execution reverted', { cause: { data } }));

        await expect(client.place({ cell: CELL, tokenId: 42n, buildingType: 1 })).rejects.toThrow(
            /cell 42 carries an open reveal request.*nothing can be built.*reveal on cell 42 or fulfill_reveal/is,
        );
    });

    it('names the reveal-in-flight revert of the cell, which no abi decoded before', () => {
        const data = encodeErrorResult({
            abi: parseAbi(['error RevealInFlight()']),
            errorName: 'RevealInFlight',
        });

        expect(describeRevert({ data }, CELL_ABI)).toBe('RevealInFlight()');
    });

    it('leaves every other revert of a build to the caller untouched', async () => {
        const data = encodeErrorResult({ abi: CELL_ABI, errorName: 'MintClosed' });
        const { client } = makeClient({}, new Error('Execution reverted: MintClosed()', { cause: { data } }));

        await expect(client.place({ cell: CELL, tokenId: 42n, buildingType: 1 })).rejects.toThrow(
            'Execution reverted: MintClosed()',
        );
    });

    it('leaves a revert of the cell itself to the caller untouched', async () => {
        const data = encodeErrorResult({ abi: CELL_ABI, errorName: 'MintClosed' });
        const { client } = makeClient({}, new Error('Execution reverted: MintClosed()', { cause: { data } }));

        await expect(client.requestReveal({ cell: CELL, tokenId: 42n, value: 1_000n })).rejects.toThrow(
            'Execution reverted: MintClosed()',
        );
    });
});
