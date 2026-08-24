import { type Abi, decodeFunctionData, type Address, type Hash } from 'viem';
import { describe, expect, it } from 'vitest';

import { TRADE_ABI } from '../../contracts/trade.abi.js';
import { OnChainLotState } from '../../contracts/trade.types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type { ConfirmedTx, IContractClient, ReadContractParams, TransactionRequest } from '../../wallet/types.js';
import { TradeClient } from '../trade.client.js';

const TRADE = '0x8888888888888888888888888888888888888888' as Address;
const SELLER = '0x00000000000000000000000000000000000000a1' as Address;
const SENT = `0x${'f'.repeat(64)}` as Hash;

class FakeContracts implements IContractClient {
    public readonly sent: Array<TransactionRequest> = [];
    public readonly reads: Array<ReadContractParams> = [];
    constructor(
        private readonly readResult: unknown = 0,
        private readonly answers: Record<string, unknown> | null = null,
    ) {}
    async read<T>(params: ReadContractParams): Promise<T> {
        this.reads.push(params);
        if (this.answers !== null && params.functionName in this.answers) {
            return this.answers[params.functionName] as T;
        }
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

function makeClient(
    readResult: unknown = 0,
    answers: Record<string, unknown> | null = null,
): { client: TradeClient; contracts: FakeContracts } {
    const contracts = new FakeContracts(readResult, answers);
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

describe('TradeClient lot and configuration reads', () => {
    const LOT = {
        seller: SELLER,
        hub: 20n,
        resource: 3,
        remaining: 80n,
        pricePerUnit: 500000000000000000n,
        state: OnChainLotState.Evicted,
        maxSaleFeeBp: 250,
        hubRadius: 5,
        hubMoveFee: 7n,
    };

    it('reads one authoritative lot by id', async () => {
        const { client, contracts } = makeClient(0, { getLot: LOT });

        expect(await client.getLot({ trade: TRADE, lotId: 7n })).toEqual(LOT);
        expect(contracts.reads[0]).toMatchObject({ address: TRADE, functionName: 'getLot', args: [7n] });
    });

    it('reads several lots in one call, in the order it was asked for them', async () => {
        const { client, contracts } = makeClient(0, { getLots: [LOT] });

        expect(await client.getLots({ trade: TRADE, lotIds: [7n, 8n] })).toEqual([LOT]);
        expect(contracts.reads[0]).toMatchObject({ functionName: 'getLots', args: [[7n, 8n]] });
    });

    it('reads the deployed trade configuration', async () => {
        const config = {
            minPricePerUnit: 0n,
            saleBurnPercent: 1,
            minLotShareBp: 10,
            maxLotShareBp: 200,
            maxLotsPerSellerResource: 5,
            minUncappedLotValue: 10000n,
            maxUncappedLotValue: 100000n,
        };
        const { client, contracts } = makeClient(0, { getConfig: config });

        expect(await client.getConfig({ trade: TRADE })).toEqual(config);
        expect(contracts.reads[0]).toMatchObject({ address: TRADE, functionName: 'getConfig', args: [] });
    });

    it('reads the effective bounds for one hub and resource', async () => {
        const { client, contracts } = makeClient(0, { getMinLotValue: 100n, getMaxLotValue: 9000n });

        expect(await client.getMinLotValue({ trade: TRADE, hub: 20n, res: 3 })).toBe(100n);
        expect(await client.getMaxLotValue({ trade: TRADE, hub: 20n, res: 3 })).toBe(9000n);
        expect(contracts.reads.map((read) => [read.functionName, read.args])).toEqual([
            ['getMinLotValue', [20n, 3]],
            ['getMaxLotValue', [20n, 3]],
        ]);
    });

    it('keys the seller counts exactly as the contract does', async () => {
        const { client, contracts } = makeClient(0, { getSellerLotCount: 2n, getSellerEvictedCount: 1n });

        expect(await client.getSellerLotCount({ trade: TRADE, seller: SELLER, hub: 20n, res: 3 })).toBe(2n);
        expect(await client.getSellerEvictedCount({ trade: TRADE, seller: SELLER, hub: 20n })).toBe(1n);
        expect(contracts.reads.map((read) => [read.functionName, read.args])).toEqual([
            ['getSellerLotCount', [SELLER, 20n, 3]],
            ['getSellerEvictedCount', [SELLER, 20n]],
        ]);
    });

    it('quotes a return for the named seller over the explicit chain', async () => {
        const quote = {
            transitFee: 900n,
            transitDiscount: 100n,
            totalDistance: 4n,
            arrivalAt: 1700000000n,
            amount: 80n,
        };
        const { client, contracts } = makeClient(0, { quoteReturn: quote });

        const read = await client.quoteReturn({
            trade: TRADE,
            lotId: 7n,
            returnTokenIds: [20n, 21n],
            seller: SELLER,
        });

        expect(read).toEqual(quote);
        expect(contracts.reads[0]).toMatchObject({ functionName: 'quoteReturn', args: [7n, [20n, 21n], SELLER] });
    });
});

describe('TradeClient eviction and reclaim writes', () => {
    it('encodes evict as the single lot it acts on', async () => {
        const { client, contracts } = makeClient();

        expect(await client.evict({ trade: TRADE, lotId: 7n })).toBe(SENT);
        const decoded = decodeFunctionData({ abi: TRADE_ABI, data: sentTx(contracts).data });
        expect(decoded.functionName).toBe('evict');
        expect(decoded.args).toEqual([7n]);
    });

    it('encodes reclaim with the lot, the explicit return chain and the fee ceiling', async () => {
        const { client, contracts } = makeClient();
        await client.reclaim({ trade: TRADE, lotId: 7n, returnTokenIds: [20n, 21n], maxFee: 900n });

        const decoded = decodeFunctionData({ abi: TRADE_ABI, data: sentTx(contracts).data });
        expect(decoded.functionName).toBe('reclaim');
        expect(decoded.args).toEqual([7n, [20n, 21n], 900n]);
    });
});
