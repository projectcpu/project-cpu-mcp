import { type Abi, decodeFunctionData, type Address, type Hash } from 'viem';
import { describe, expect, it } from 'vitest';

import { TRADE_ABI } from '../../contracts/trade.abi.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type { ConfirmedTx, IContractClient, ReadContractParams, TransactionRequest } from '../../wallet/types.js';
import { TradeClient } from '../trade.client.js';

const TRADE = '0x8888888888888888888888888888888888888888' as Address;
const SENT = `0x${'f'.repeat(64)}` as Hash;

class FakeContracts implements IContractClient {
    public readonly sent: Array<TransactionRequest> = [];
    public readonly reads: Array<ReadContractParams> = [];
    constructor(private readonly readResult: unknown = 0) {}
    async read<T>(params: ReadContractParams): Promise<T> {
        this.reads.push(params);
        return this.readResult as T;
    }
    async estimateGas(): Promise<bigint> {
        return 21_000n;
    }
    async send(tx: TransactionRequest, _errorAbi: Abi | null): Promise<Hash> {
        this.sent.push(tx);
        return SENT;
    }
    async confirm(): Promise<ConfirmedTx> {
        throw new Error('unused');
    }
}

function makeClient(readResult: unknown = 0): { client: TradeClient; contracts: FakeContracts } {
    const contracts = new FakeContracts(readResult);
    return { client: new TradeClient({ contracts, logger: new NoopLogger() }), contracts };
}

function sentTx(contracts: FakeContracts): TransactionRequest {
    const tx = contracts.sent[0];
    if (tx === undefined) {
        throw new Error('expected a tx');
    }
    return tx;
}

describe('TradeClient', () => {
    it('encodes the 6-argument createLot (tolerance before maxFee) with no value', async () => {
        const { client, contracts } = makeClient();
        const hash = await client.createLot({
            trade: TRADE,
            tokenIds: [72n, 73n],
            res: 3,
            value: 100n,
            price: 500000000000000000n,
            maxSaleFeeBp: 250,
            maxFee: 1100n,
        });

        expect(hash).toBe(SENT);
        const tx = sentTx(contracts);
        expect(tx.to).toBe(TRADE);
        expect(tx.value).toBeNull();
        const decoded = decodeFunctionData({ abi: TRADE_ABI, data: tx.data });
        expect(decoded.functionName).toBe('createLot');
        expect(decoded.args).toEqual([[72n, 73n], 3, 100n, 500000000000000000n, 250, 1100n]);
    });

    it('encodes buy', async () => {
        const { client, contracts } = makeClient();
        await client.buy({ trade: TRADE, lotId: 7n, value: 10n, destTokenIds: [73n, 74n], maxFee: 0n });

        const decoded = decodeFunctionData({ abi: TRADE_ABI, data: sentTx(contracts).data });
        expect(decoded.functionName).toBe('buy');
        expect(decoded.args).toEqual([7n, 10n, [73n, 74n], 0n]);
    });

    it('encodes cancel', async () => {
        const { client, contracts } = makeClient();
        await client.cancel({ trade: TRADE, lotId: 7n, returnTokenIds: [74n, 73n], maxFee: 5n });

        const decoded = decodeFunctionData({ abi: TRADE_ABI, data: sentTx(contracts).data });
        expect(decoded.functionName).toBe('cancel');
        expect(decoded.args).toEqual([7n, [74n, 73n], 5n]);
    });

    it('encodes setSaleFee and sends it to the Trade contract with no value', async () => {
        const { client, contracts } = makeClient();
        const hash = await client.setSaleFee({ trade: TRADE, hub: 20n, res: 3, feeBp: 250 });

        expect(hash).toBe(SENT);
        const tx = sentTx(contracts);
        expect(tx.to).toBe(TRADE);
        expect(tx.value).toBeNull();
        const decoded = decodeFunctionData({ abi: TRADE_ABI, data: tx.data });
        expect(decoded.functionName).toBe('setSaleFee');
        expect(decoded.args).toEqual([20n, 3, 250]);
    });

    it('reads getSaleFee and returns the rate as a number', async () => {
        const { client, contracts } = makeClient(250);
        const feeBp = await client.getSaleFee({ trade: TRADE, hub: 20n, res: 3 });

        expect(feeBp).toBe(250);
        expect(contracts.reads[0]).toMatchObject({ address: TRADE, functionName: 'getSaleFee', args: [20n, 3] });
    });
});
