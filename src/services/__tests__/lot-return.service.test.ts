import {
    decodeFunctionData,
    encodeAbiParameters,
    encodeErrorResult,
    encodeEventTopics,
    maxUint256,
    parseAbiItem,
    parseEther,
    type Abi,
    type Address,
    type Hash,
    type Hex,
    type Log,
} from 'viem';
import { describe, expect, it } from 'vitest';

import {
    CPU_TOKEN,
    FakeAllowance,
    FakeAppConfig,
    FakeContractClient,
    FakeMapReader,
    FakeWallet,
    TRADE,
    TRANSPORT,
    WALLET_ADDRESS,
    makeConfig,
    transitSettledLog,
    type FakeReadResult,
} from './service-fakes.js';
import { LotState } from '../../api/types.js';
import { TRADE_ABI } from '../../contracts/trade.abi.js';
import { OnChainLotState } from '../../contracts/trade.types.js';
import { TRANSPORT_ABI } from '../../contracts/transport.abi.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { makeCell, makeResource, makeStorage } from '../../map/__tests__/fixtures.js';
import { toCell } from '../../map/cell-view.utils.js';
import { toProjectionConfig } from '../../map/reader.utils.js';
import type { Cell, RawCellResourceStorage } from '../../map/types.js';
import type { TransactionRequest, WalletProvider } from '../../wallet/types.js';
import { LotReturnService } from '../lot-return.service.js';
import { TradeClient } from '../trade.client.js';
import { LotReturnBranch, type OnChainLot, type ReturnQuoteResult } from '../types.js';

const HUB = 20n;
const DESTINATION = 31n;
const RESOURCE = 5;
const LOT_ID = '7';
const CHAIN = [Number(HUB), Number(DESTINATION)];

const QUOTED_FEE_WEI = 700_000_000_000_000_000n;
const QUOTED_DISCOUNT_WEI = 200_000_000_000_000_000n;
const REMAINDER = 80n;

const DELIVERY_SCHEDULED_EVENT = parseAbiItem(
    'event DeliveryScheduled(uint256 indexed deliveryId, address indexed payer, uint256 sourceId, ' +
        'address receiver, uint256 targetId, uint16 resource, uint64 amount, uint64 arrivalAt, ' +
        'uint256[] waypoints, uint64 scheduledAt)',
);

function chainLot(over: Partial<OnChainLot> = {}): OnChainLot {
    return {
        seller: WALLET_ADDRESS,
        hub: HUB,
        resource: RESOURCE,
        remaining: REMAINDER,
        pricePerUnit: 500_000_000_000_000_000n,
        state: OnChainLotState.Open,
        maxSaleFeeBp: 250,
        hubRadius: 3,
        hubMoveFee: 0n,
        ...over,
    };
}

function returnQuote(over: Partial<ReturnQuoteResult> = {}): ReturnQuoteResult {
    return {
        transitFee: QUOTED_FEE_WEI,
        transitDiscount: QUOTED_DISCOUNT_WEI,
        totalDistance: 4n,
        arrivalAt: 1_700_000_900n,
        amount: REMAINDER,
        ...over,
    };
}

function tradeLog(topics: Array<Hex>, data: Hex): Log {
    return {
        address: TRADE,
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

function lotCancelledLog(returned: bigint): Log {
    const topics = encodeEventTopics({
        abi: TRADE_ABI,
        eventName: 'LotCancelled',
        args: { lotId: BigInt(LOT_ID), seller: WALLET_ADDRESS },
    });
    const data = encodeAbiParameters([{ name: 'returned', type: 'uint128' }], [returned]);
    return tradeLog(topics as Array<Hex>, data);
}

function scheduledLog(deliveryId: bigint, targetId: bigint, arrivalAt: bigint): Log {
    const topics = encodeEventTopics({
        abi: [DELIVERY_SCHEDULED_EVENT],
        eventName: 'DeliveryScheduled',
        args: { deliveryId, payer: WALLET_ADDRESS },
    });
    const data = encodeAbiParameters(
        [
            { name: 'sourceId', type: 'uint256' },
            { name: 'receiver', type: 'address' },
            { name: 'targetId', type: 'uint256' },
            { name: 'resource', type: 'uint16' },
            { name: 'amount', type: 'uint64' },
            { name: 'arrivalAt', type: 'uint64' },
            { name: 'waypoints', type: 'uint256[]' },
            { name: 'scheduledAt', type: 'uint64' },
        ],
        [HUB, WALLET_ADDRESS, targetId, RESOURCE, REMAINDER, arrivalAt, [HUB, targetId], 1_700_000_000n],
    );
    return {
        address: TRANSPORT,
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

function revertWith(abi: Abi, errorName: string): Error {
    const data = encodeErrorResult({ abi, errorName });
    const error = new Error('Execution reverted') as Error & { data: Hex };
    error.data = data;
    return error;
}

class RevertingContractClient extends FakeContractClient {
    constructor(
        private readonly failure: Error,
        reads: Record<string, FakeReadResult>,
    ) {
        super([], [], reads);
    }
    async send(tx: TransactionRequest): Promise<Hash> {
        this.sent.push(tx);
        throw this.failure;
    }
}

function destinationCell(storage: RawCellResourceStorage | null = makeStorage()): Cell {
    const config = makeConfig();
    return toCell(
        makeCell({
            tokenId: DESTINATION.toString(),
            owner: WALLET_ADDRESS,
            resources: [makeResource({ resourceId: RESOURCE, storage })],
        }),
        1_700_000_000,
        toProjectionConfig(config),
    );
}

interface HarnessOptions {
    lot: OnChainLot;
    quote: ReturnQuoteResult;
    cell: Cell | null;
    logs: Array<Log>;
    failure: Error | null;
}

function makeService(over: Partial<HarnessOptions> = {}) {
    const opts: HarnessOptions = {
        lot: chainLot(),
        quote: returnQuote(),
        cell: destinationCell(),
        logs: [lotCancelledLog(REMAINDER), scheduledLog(123n, DESTINATION, 1_700_000_900n)],
        failure: null,
        ...over,
    };
    const config = makeConfig();
    const reads: Record<string, FakeReadResult> = { getLot: opts.lot, quoteReturn: opts.quote };
    const contracts =
        opts.failure === null
            ? new FakeContractClient([], [opts.logs], reads)
            : new RevertingContractClient(opts.failure, reads);
    const wallet = new FakeWallet(config.chainId);
    const allowance = new FakeAllowance(`0x${'c'.repeat(64)}` as Hash);
    const mapReader = new FakeMapReader(opts.cell, 1_700_000_000);
    const service = new LotReturnService({
        wallet: wallet as unknown as WalletProvider,
        appConfig: new FakeAppConfig(config),
        allowance,
        contracts,
        tradeClient: new TradeClient({ contracts, logger: new NoopLogger() }),
        mapReader,
        logger: new NoopLogger(),
    });
    return { service, contracts, allowance, mapReader };
}

function sentCall(contracts: FakeContractClient): { functionName: string; args: ReadonlyArray<unknown> } {
    const tx = contracts.sent[0];
    if (tx === undefined) {
        throw new Error('nothing was sent');
    }
    const decoded = decodeFunctionData({ abi: TRADE_ABI, data: tx.data as Hex });
    return { functionName: decoded.functionName, args: decoded.args ?? [] };
}

/** The honest caller: the ceiling is exactly the figure the quote in this harness hands back. */
const input = { lotId: LOT_ID, chain: CHAIN, maxTransitFeeWei: QUOTED_FEE_WEI.toString() };

describe('LotReturnService quote', () => {
    it('reports the whole current remainder the contract priced, not the caller amount', async () => {
        const { service } = makeService();
        const quote = await service.quoteReturn(input);
        expect(quote.amount).toBe('80');
        expect(quote.lotId).toBe(LOT_ID);
        expect(quote.hubTokenId).toBe('20');
        expect(quote.resourceId).toBe(RESOURCE);
        expect(quote.destinationTokenId).toBe('31');
    });

    it('carries the contract fee, discount, distance and ETA through without arithmetic of its own', async () => {
        const { service } = makeService();
        const quote = await service.quoteReturn(input);
        expect(quote.maxTransitFee).toBe('0.7');
        expect(quote.maxTransitFeeWei).toBe(QUOTED_FEE_WEI.toString());
        expect(quote.transitDiscount).toBe('0.2');
        expect(quote.totalDistance).toBe(4);
        expect(quote.arrivalAt).toBe(1_700_000_900);
    });

    it('prices the return through the Trade return quote for the authenticated seller', async () => {
        const { service, contracts } = makeService();
        await service.quoteReturn(input);
        const read = contracts.reads.find((r) => r.functionName === 'quoteReturn');
        expect(read?.args).toEqual([7n, [HUB, DESTINATION], WALLET_ADDRESS]);
        expect(read?.address).toBe(TRADE);
    });

    it('spends nothing while quoting', async () => {
        const { service, contracts, allowance } = makeService();
        await service.quoteReturn(input);
        expect(contracts.sent).toEqual([]);
        expect(allowance.calls).toEqual([]);
    });

    it('judges the destination on freshly refreshed storage state', async () => {
        const { service, mapReader } = makeService();
        await service.quoteReturn(input);
        expect(mapReader.refreshed).toBe(1);
    });

    it('counts what the destination already holds and everything reserved on it', async () => {
        const { service } = makeService({
            cell: destinationCell(
                makeStorage({
                    used: '10',
                    cellCap: '100',
                    reserved: { incomingTransport: '20', lots: '30' },
                }),
            ),
        });
        const quote = await service.quoteReturn(input);
        expect(quote.capacity).toEqual({ fits: false, required: '80', free: '40' });
    });

    it('fits the remainder when it exactly fills the free space that is left', async () => {
        const { service } = makeService({
            cell: destinationCell(
                makeStorage({
                    used: '10',
                    cellCap: '100',
                    reserved: { incomingTransport: '5', lots: '5' },
                }),
            ),
        });
        const quote = await service.quoteReturn(input);
        expect(quote.capacity).toEqual({ fits: true, required: '80', free: '80' });
    });

    it('refuses one unit more than the destination can take', async () => {
        const { service } = makeService({
            cell: destinationCell(
                makeStorage({
                    used: '11',
                    cellCap: '100',
                    reserved: { incomingTransport: '5', lots: '5' },
                }),
            ),
        });
        const quote = await service.quoteReturn(input);
        expect(quote.capacity).toEqual({ fits: false, required: '80', free: '79' });
    });

    it('never treats a null non-WCPU cap as unlimited destination room', async () => {
        const { service } = makeService({
            cell: destinationCell(makeStorage({ used: '9999', cellCap: null, hubCap: null })),
        });
        const quote = await service.quoteReturn(input);
        expect(quote.capacity).toEqual({ fits: false, required: '80', free: '0' });
    });

    it('refuses to guess when the destination cell cannot be read at all', async () => {
        const { service } = makeService({ cell: null });
        await expect(service.quoteReturn(input)).rejects.toThrow(/31/);
    });
});

describe('LotReturnService settlement', () => {
    it('settles an Open lot through cancel and names the branch', async () => {
        const { service, contracts } = makeService();
        const result = await service.returnLot(input);
        expect(sentCall(contracts).functionName).toBe('cancel');
        expect(result.branch).toBe(LotReturnBranch.Cancelled);
        expect(result.originalState).toBe(LotState.Open);
    });

    it('settles an Evicted lot through reclaim and names the branch', async () => {
        const { service, contracts } = makeService({ lot: chainLot({ state: OnChainLotState.Evicted }) });
        const result = await service.returnLot(input);
        expect(sentCall(contracts).functionName).toBe('reclaim');
        expect(result.branch).toBe(LotReturnBranch.Reclaimed);
        expect(result.originalState).toBe(LotState.Evicted);
    });

    it('carries the ceiling the seller passed as the fee cap, never the figure it just re-quoted', async () => {
        const { service, contracts } = makeService({ quote: returnQuote({ transitFee: QUOTED_FEE_WEI - 1n }) });
        await service.returnLot(input);
        expect(sentCall(contracts).args).toEqual([7n, [HUB, DESTINATION], QUOTED_FEE_WEI]);
    });

    it('authorizes exactly the ceiling the seller passed and nothing more', async () => {
        const { service, allowance } = makeService();
        const result = await service.returnLot(input);
        expect(allowance.calls).toEqual([{ token: CPU_TOKEN, spender: TRANSPORT, needed: QUOTED_FEE_WEI }]);
        expect(result.approveTxHash).toBe(`0x${'c'.repeat(64)}`);
    });

    it('skips the approval when the route is free and the ceiling is zero', async () => {
        const { service, allowance, contracts } = makeService({ quote: returnQuote({ transitFee: 0n }) });
        const result = await service.returnLot({ ...input, maxTransitFeeWei: '0' });
        expect(allowance.calls).toEqual([]);
        expect(result.approveTxHash).toBeNull();
        expect(sentCall(contracts).args[2]).toBe(0n);
    });

    // The price, not the ceiling, decides whether an allowance is needed: an honest non-zero ceiling on a
    // route that happens to cost nothing must not buy an unbounded approve.
    it('skips the approval on a free route even when the ceiling the seller passed is not zero', async () => {
        const { service, allowance, contracts } = makeService({ quote: returnQuote({ transitFee: 0n }) });
        const result = await service.returnLot(input);
        expect(allowance.calls).toEqual([]);
        expect(result.approveTxHash).toBeNull();
        expect(sentCall(contracts).args[2]).toBe(QUOTED_FEE_WEI);
    });

    it('still approves when the route costs a single wei, however large the ceiling capping it', async () => {
        const { service, allowance } = makeService({ quote: returnQuote({ transitFee: 1n }) });
        await service.returnLot(input);
        expect(allowance.calls).toEqual([{ token: CPU_TOKEN, spender: TRANSPORT, needed: QUOTED_FEE_WEI }]);
    });

    it('returns the whole remainder the lot event reports, with the delivery to finalize', async () => {
        const { service } = makeService();
        const result = await service.returnLot(input);
        expect(result.returned).toBe('80');
        expect(result.deliveryId).toBe('123');
        expect(result.arrivalAt).toBe(1_700_000_900);
        expect(result.destinationTokenId).toBe('31');
        expect(result.resourceId).toBe(RESOURCE);
        expect(result.hubTokenId).toBe('20');
    });

    it('reports the transit actually settled on the receipt, not the quote, when the two differ', async () => {
        const { service } = makeService({
            logs: [
                lotCancelledLog(REMAINDER),
                scheduledLog(123n, DESTINATION, 1_700_000_900n),
                transitSettledLog({
                    deliveryId: 123n,
                    owner: WALLET_ADDRESS,
                    gross: 600_000_000_000_000_000n,
                    discount: 100_000_000_000_000_000n,
                }),
            ],
        });
        const result = await service.returnLot(input);
        expect(result.transitPaid).toBe('0.5');
        expect(result.transitDiscount).toBe('0.1');
    });

    it('refuses a lot that is still delivering, before any approval or transaction', async () => {
        const { service, contracts, allowance } = makeService({
            lot: chainLot({ state: OnChainLotState.Delivering }),
        });
        await expect(service.returnLot(input)).rejects.toThrow(/delivering/i);
        expect(contracts.sent).toEqual([]);
        expect(allowance.calls).toEqual([]);
    });

    it('refuses a lot that no longer exists on-chain, before any approval or transaction', async () => {
        const { service, contracts, allowance } = makeService({ lot: chainLot({ state: OnChainLotState.None }) });
        await expect(service.returnLot(input)).rejects.toThrow(/closed/i);
        expect(contracts.sent).toEqual([]);
        expect(allowance.calls).toEqual([]);
    });

    it('refuses a lot that belongs to somebody else, before any approval or transaction', async () => {
        const { service, contracts, allowance } = makeService({
            lot: chainLot({ seller: '0x00000000000000000000000000000000000000f1' as Address }),
        });
        await expect(service.returnLot(input)).rejects.toThrow(/not yours/i);
        expect(contracts.sent).toEqual([]);
        expect(allowance.calls).toEqual([]);
    });

    it('refuses a route that does not start at the hub holding the lot', async () => {
        const { service, contracts, allowance } = makeService();
        await expect(service.returnLot({ ...input, chain: [99, Number(DESTINATION)] })).rejects.toThrow(
            /must start at the lot's hub/i,
        );
        expect(contracts.sent).toEqual([]);
        expect(allowance.calls).toEqual([]);
    });

    it('refuses a route that visits the same cell twice', async () => {
        const { service, contracts } = makeService();
        await expect(
            service.returnLot({ ...input, chain: [Number(HUB), Number(HUB), Number(DESTINATION)] }),
        ).rejects.toThrow(/twice/i);
        expect(contracts.sent).toEqual([]);
    });

    it('refuses a quote that covers less than the whole remainder, so no partial return is ever sent', async () => {
        const { service, contracts, allowance } = makeService({ quote: returnQuote({ amount: 79n }) });
        await expect(service.returnLot(input)).rejects.toThrow(/whole remainder/i);
        expect(contracts.sent).toEqual([]);
        expect(allowance.calls).toEqual([]);
    });

    it('refuses an insufficient destination before allowance or transaction, naming what is needed and free', async () => {
        const { service, contracts, allowance } = makeService({
            cell: destinationCell(
                makeStorage({ used: '10', cellCap: '100', reserved: { incomingTransport: '20', lots: '30' } }),
            ),
        });
        await expect(service.returnLot(input)).rejects.toThrow(/80.*40|40.*80/s);
        expect(contracts.sent).toEqual([]);
        expect(allowance.calls).toEqual([]);
    });

    it('fails closed on transit fee drift and sends the agent back for a fresh quote', async () => {
        const { service } = makeService({ failure: revertWith(TRANSPORT_ABI as Abi, 'FeeExceedsMax') });
        await expect(service.returnLot(input)).rejects.toThrow(/quote .*again/i);
    });

    it('decodes a lot that stopped being Open between the quote and the transaction', async () => {
        const { service } = makeService({ failure: revertWith(TRADE_ABI as Abi, 'LotNotOpen') });
        await expect(service.returnLot(input)).rejects.toThrow(/no longer open/i);
    });

    it('decodes a reclaim refused because the lot is not evicted', async () => {
        const { service } = makeService({
            lot: chainLot({ state: OnChainLotState.Evicted }),
            failure: revertWith(TRADE_ABI as Abi, 'LotNotEvicted'),
        });
        await expect(service.returnLot(input)).rejects.toThrow(/not evicted/i);
    });

    it('decodes a destination the caller does not own', async () => {
        const { service } = makeService({ failure: revertWith(TRADE_ABI as Abi, 'NotDestOwner') });
        await expect(service.returnLot(input)).rejects.toThrow(/own/i);
    });

    it('reads the lot state from the chain, never from the projection', async () => {
        const { service, contracts } = makeService();
        await service.returnLot(input);
        const order = contracts.reads.map((r) => r.functionName);
        expect(order.indexOf('getLot')).toBe(0);
        expect(order).toContain('quoteReturn');
    });
});

describe('LotReturnService fee ceiling', () => {
    it('refuses a route that outgrew the seller ceiling before allowance, transaction or map read', async () => {
        const { service, contracts, allowance, mapReader } = makeService({
            quote: returnQuote({ transitFee: QUOTED_FEE_WEI * 13n }),
        });
        await expect(service.returnLot(input)).rejects.toThrow(/above the 0\.7 \$CPU ceiling/);
        expect(contracts.sent).toEqual([]);
        expect(allowance.calls).toEqual([]);
        expect(mapReader.refreshed).toBe(0);
    });

    it('names the fee it just priced and the ceiling it was given, in $CPU and in wei', async () => {
        const { service } = makeService({ quote: returnQuote({ transitFee: QUOTED_FEE_WEI * 13n }) });
        const error = await service.returnLot(input).catch((e: Error) => e);
        const message = (error as Error).message;
        expect(message).toContain('9.1 $CPU');
        expect(message).toContain((QUOTED_FEE_WEI * 13n).toString());
        expect(message).toContain('0.7 $CPU');
        expect(message).toContain(QUOTED_FEE_WEI.toString());
        expect(message).toMatch(/quote the return again/i);
    });

    it('refuses a single wei over the ceiling, so the promise has no slack in it', async () => {
        const { service, contracts } = makeService({ quote: returnQuote({ transitFee: QUOTED_FEE_WEI + 1n }) });
        await expect(service.returnLot(input)).rejects.toThrow(/ceiling/i);
        expect(contracts.sent).toEqual([]);
    });

    it('proceeds when the fresh price lands exactly on the ceiling', async () => {
        const { service, contracts } = makeService();
        const result = await service.returnLot(input);
        expect(sentCall(contracts).args[2]).toBe(QUOTED_FEE_WEI);
        expect(result.txHash).toBeDefined();
    });

    it('proceeds under the ceiling and reports the lower figure the receipt actually settled', async () => {
        const cheaper = QUOTED_FEE_WEI - 100_000_000_000_000_000n;
        const { service, contracts } = makeService({
            quote: returnQuote({ transitFee: cheaper }),
            logs: [
                lotCancelledLog(REMAINDER),
                scheduledLog(123n, DESTINATION, 1_700_000_900n),
                transitSettledLog({ deliveryId: 123n, owner: WALLET_ADDRESS, gross: cheaper, discount: 0n }),
            ],
        });
        const result = await service.returnLot(input);
        expect(result.transitPaid).toBe('0.6');
        expect(sentCall(contracts).args[2]).toBe(QUOTED_FEE_WEI);
    });

    it('refuses a ceiling written as decimal $CPU, before it reads anything on-chain', async () => {
        const { service, contracts } = makeService();
        await expect(service.returnLot({ ...input, maxTransitFeeWei: '0.7' })).rejects.toThrow(/whole number of wei/i);
        expect(contracts.reads).toEqual([]);
        expect(contracts.sent).toEqual([]);
    });

    // Padding the figure is how an agent tries to switch the guard off. It is still digits, so the shape
    // check waves it through — and without this refusal the allowance goes out before the encoder throws.
    it('refuses a ceiling padded past uint256 before it reads, approves or sends anything', async () => {
        const { service, contracts, allowance } = makeService();
        const padded = (maxUint256 + 1n).toString();
        await expect(service.returnLot({ ...input, maxTransitFeeWei: padded })).rejects.toThrow(
            /past the uint256 maximum/i,
        );
        expect(contracts.reads).toEqual([]);
        expect(contracts.sent).toEqual([]);
        expect(allowance.calls).toEqual([]);
    });

    it('answers a padded ceiling in its own words rather than letting an encoding error through', async () => {
        const { service } = makeService();
        const padded = (maxUint256 * 2n).toString();
        const error = await service.returnLot({ ...input, maxTransitFeeWei: padded }).catch((e: Error) => e);
        expect((error as Error).message).toContain(padded);
        expect((error as Error).message).toMatch(/cpu_quote_lot_return/);
        expect((error as Error).name).toBe('Error');
    });

    it('takes a ceiling that lands exactly on uint256, so the refusal is not one wei early', async () => {
        const { service, contracts } = makeService();
        const result = await service.returnLot({ ...input, maxTransitFeeWei: maxUint256.toString() });
        expect(sentCall(contracts).args[2]).toBe(maxUint256);
        expect(result.txHash).toBeDefined();
    });

    // The ceiling travels as wei end to end, so the $CPU the seller reads and the cap the contract gets are
    // the same integer — including the awkward magnitudes a decimal roundtrip would shave a wei off.
    it.each([1n, 27_473_849_233_960_000n, 357_160_040_041_480_000n, 1_000_000_000_000_000_000n, 999n])(
        'quotes %s wei as a $CPU figure that parses back to the very same wei',
        async (fee) => {
            const { service, contracts } = makeService({ quote: returnQuote({ transitFee: fee }) });
            const quote = await service.quoteReturn(input);
            expect(BigInt(quote.maxTransitFeeWei)).toBe(fee);
            expect(parseEther(quote.maxTransitFee)).toBe(fee);

            await service.returnLot({ ...input, maxTransitFeeWei: quote.maxTransitFeeWei });
            expect(sentCall(contracts).args[2]).toBe(fee);
        },
    );
});
