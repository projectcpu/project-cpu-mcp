import {
    encodeAbiParameters,
    encodeEventTopics,
    formatEther,
    parseAbiItem,
    parseEther,
    zeroAddress,
    type Address,
    type Hash,
    type Log,
} from 'viem';
import { describe, expect, it } from 'vitest';

import type { ApiClient } from '../../api/client.js';
import {
    type ApiFillView,
    type ApiLotView,
    type ApiMarketIndexRow,
    type ApiMarketResourceSummary,
    LotAvailability,
    LotState,
} from '../../api/types.js';
import { TRADE_ABI } from '../../contracts/trade.abi.js';
import { OnChainLotState } from '../../contracts/trade.types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import {
    type ConfirmedTx,
    type IContractClient,
    type ReadContractParams,
    TxStatus,
    type WalletProvider,
} from '../../wallet/types.js';
import { TradeService } from '../trade.service.js';
import type {
    BuyLotParams,
    BuyQuoteResult,
    CancelLotParams,
    CreateLotParams,
    EvictLotParams,
    FinalizeParams,
    GetLotParams,
    GetLotsParams,
    GetSaleFeeParams,
    GetTradeConfigParams,
    ITradeClient,
    ITransportClient,
    LotBoundParams,
    MoveParams,
    OnChainLot,
    OnChainTradeConfig,
    QuoteBuyParams,
    QuoteReturnParams,
    QuoteRouteParams,
    QuoteSaleParams,
    ReclaimLotParams,
    ReturnQuoteResult,
    RouteQuote,
    SaleQuoteResult,
    SellerEvictedCountParams,
    SellerLotCountParams,
    SetSaleFeeParams,
} from '../types.js';
import {
    APPROVE_HASH,
    CPU_TOKEN,
    FakeAllowance,
    FakeApi,
    FakeAppConfig,
    FakeWallet,
    TRADE,
    TRANSPORT,
    WALLET_ADDRESS,
    makeConfig,
    transitSettledLog,
} from './service-fakes.js';

const FOREIGN_OWNER = '0x00000000000000000000000000000000000000f1' as Address;
const LOT_BOUGHT_EVENT = parseAbiItem(
    'event LotBought(uint256 indexed lotId, address indexed buyer, uint128 value, uint128 remaining, ' +
        'uint256 sale, uint256 hubFee, uint256 burn, uint256 discount, uint256 tax, uint256 ownerNet, ' +
        'uint256 buyerSyndicateId, uint256 ownerSyndicateId, address taxTo, address hubOwner, uint64 settledAt)',
);
const DELIVERY_SCHEDULED_EVENT = parseAbiItem(
    'event DeliveryScheduled(uint256 indexed deliveryId, address indexed payer, uint256 sourceId, ' +
        'address receiver, uint256 targetId, uint16 resource, uint64 amount, uint64 arrivalAt, ' +
        'uint256[] waypoints, uint64 scheduledAt)',
);

const CREATE_HASH = `0x${'1'.repeat(64)}` as Hash;
const BUY_HASH = `0x${'2'.repeat(64)}` as Hash;
const CANCEL_HASH = `0x${'3'.repeat(64)}` as Hash;
const SET_FEE_HASH = `0x${'4'.repeat(64)}` as Hash;
const RECLAIM_HASH = `0x${'5'.repeat(64)}` as Hash;
const EVICT_HASH = `0x${'6'.repeat(64)}` as Hash;

const CREATE_INPUT = {
    chain: [72, 73],
    resourceId: 3,
    value: '100',
    pricePerUnit: '0.5',
    maxSaleFeePercent: null,
};

function lotView(over: Partial<ApiLotView> = {}): ApiLotView {
    return {
        id: '7',
        hubTokenId: '20',
        sellerAddress: WALLET_ADDRESS,
        resourceId: 3,
        listed: '100',
        remaining: '100',
        pricePerUnit: '0.5',
        saleFeeBp: 250,
        maxSaleFeeBp: 5000,
        state: LotState.Open,
        distanceFromAnchor: null,
        createdAt: 1700,
        updated: 1700,
        ...over,
    };
}

function marketRow(over: Partial<ApiMarketResourceSummary> = {}): ApiMarketResourceSummary {
    return {
        hubTokenId: '20',
        resourceId: 3,
        openLots: 2,
        openRemaining: '100',
        minPricePerUnit: '0.5',
        incomingLots: 0,
        incomingRemaining: '0',
        frozenLots: 0,
        frozenRemaining: '0',
        distanceFromAnchor: null,
        ...over,
    };
}

const LIST_QUERY = {
    hub: null,
    resourceId: null,
    seller: null,
    minPrice: null,
    maxPrice: null,
    availability: null,
    sort: null,
    limit: null,
    offset: null,
    aroundTokenId: null,
    radius: null,
};

const MARKETS_QUERY = { hub: null, resourceId: null, aroundTokenId: null, radius: null };

function fillRow(over: Partial<ApiFillView> = {}): ApiFillView {
    return {
        lotId: '7',
        blockNumber: 1200,
        logIndex: 4,
        transactionHash: '0xfill',
        hubTokenId: '20',
        resourceId: 3,
        seller: '0xseller',
        buyer: '0xbuyer',
        value: '10',
        remaining: '90',
        sale: '5',
        hubFee: '0.125',
        burn: '0.05',
        pricePerUnit: '0.5',
        settledAt: 1700,
        ...over,
    };
}

const FILLS_QUERY = { resourceId: null, hubTokenId: null, before: null, limit: null };

function marketIndexRow(over: Partial<ApiMarketIndexRow> = {}): ApiMarketIndexRow {
    return {
        resourceId: 3,
        priceCpu: '0.5',
        changePct: 3.2,
        volume: '120',
        spark: ['0.4', '0.5'],
        ...over,
    };
}

function tradeLog(topics: unknown, data: unknown): Log {
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

function createdLog(args: { lotId: bigint; hub: bigint; maxSaleFeeBp: number }): Log {
    const topics = encodeEventTopics({
        abi: TRADE_ABI,
        eventName: 'LotCreated',
        args: { lotId: args.lotId, seller: WALLET_ADDRESS, hub: args.hub },
    });
    const data = encodeAbiParameters(
        [
            { name: 'resource', type: 'uint16' },
            { name: 'value', type: 'uint128' },
            { name: 'pricePerUnit', type: 'uint128' },
            { name: 'maxSaleFeeBp', type: 'uint16' },
        ],
        [3, 100n, parseEther('0.5'), args.maxSaleFeeBp],
    );
    return tradeLog(topics, data);
}

function boughtLog(args: {
    lotId: bigint;
    value: bigint;
    remaining: bigint;
    sale: bigint;
    hubFee: bigint;
    burn: bigint;
    discount: bigint;
    tax: bigint;
    ownerNet: bigint;
    buyerSyndicateId: bigint;
    ownerSyndicateId: bigint;
    taxTo: Address;
    settledAt: bigint;
}): Log {
    const topics = encodeEventTopics({
        abi: [LOT_BOUGHT_EVENT],
        eventName: 'LotBought',
        args: { lotId: args.lotId, buyer: WALLET_ADDRESS },
    });
    const data = encodeAbiParameters(
        [
            { name: 'value', type: 'uint128' },
            { name: 'remaining', type: 'uint128' },
            { name: 'sale', type: 'uint256' },
            { name: 'hubFee', type: 'uint256' },
            { name: 'burn', type: 'uint256' },
            { name: 'discount', type: 'uint256' },
            { name: 'tax', type: 'uint256' },
            { name: 'ownerNet', type: 'uint256' },
            { name: 'buyerSyndicateId', type: 'uint256' },
            { name: 'ownerSyndicateId', type: 'uint256' },
            { name: 'taxTo', type: 'address' },
            { name: 'hubOwner', type: 'address' },
            { name: 'settledAt', type: 'uint64' },
        ],
        [
            args.value,
            args.remaining,
            args.sale,
            args.hubFee,
            args.burn,
            args.discount,
            args.tax,
            args.ownerNet,
            args.buyerSyndicateId,
            args.ownerSyndicateId,
            args.taxTo,
            FOREIGN_OWNER,
            args.settledAt,
        ],
    );
    return tradeLog(topics, data);
}

function cancelledLog(args: { lotId: bigint; returned: bigint }): Log {
    const topics = encodeEventTopics({
        abi: TRADE_ABI,
        eventName: 'LotCancelled',
        args: { lotId: args.lotId, seller: WALLET_ADDRESS },
    });
    const data = encodeAbiParameters([{ name: 'returned', type: 'uint128' }], [args.returned]);
    return tradeLog(topics, data);
}

function saleFeeChangedLog(args: { hub: bigint; resource: number; feeBp: number }): Log {
    const topics = encodeEventTopics({
        abi: TRADE_ABI,
        eventName: 'SaleFeeChanged',
        args: { hubTokenId: args.hub, resource: args.resource },
    });
    const data = encodeAbiParameters([{ name: 'feeBp', type: 'uint16' }], [args.feeBp]);
    return tradeLog(topics, data);
}

function scheduledLog(deliveryId: bigint, arrivalAt: bigint): Log {
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
        [10n, WALLET_ADDRESS, 20n, 3, 100n, arrivalAt, [10n, 20n], 1_700_000_000n],
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

class FakeContractClient implements IContractClient {
    constructor(
        private readonly logs: Array<Log> = [],
        private readonly reverts: boolean = false,
    ) {}
    async read<T>(_params: ReadContractParams): Promise<T> {
        return undefined as T;
    }
    async estimateGas(): Promise<bigint> {
        return 21_000n;
    }
    async send(): Promise<Hash> {
        throw new Error('TradeService should send via the trade client, not contracts.send');
    }
    async confirm(hash: Hash, revertLabel: string): Promise<ConfirmedTx> {
        if (this.reverts) {
            throw new Error(`${revertLabel} reverted on-chain (tx ${hash}).`);
        }
        return { txHash: hash, status: TxStatus.Success, blockNumber: '100', logs: this.logs };
    }
}

function fakeSaleQuote(over: Partial<SaleQuoteResult> = {}): SaleQuoteResult {
    return {
        buyerTotal: parseEther('5'),
        sellerNet: parseEther('5'),
        sale: parseEther('5'),
        feeBp: 250,
        hubFee: 0n,
        burn: 0n,
        discount: 0n,
        tax: 0n,
        ownerNet: 0n,
        ...over,
    };
}

function fakeBuyQuote(over: Partial<BuyQuoteResult> = {}): BuyQuoteResult {
    return {
        sale: fakeSaleQuote(over.sale),
        transitFee: 1_000n,
        transitDiscount: 0n,
        arrivalAt: 1704n,
        totalCost: parseEther('5') + 1_000n,
        ...over,
    };
}

class FakeTradeClient implements ITradeClient {
    public readonly creates: Array<CreateLotParams> = [];
    public readonly buys: Array<BuyLotParams> = [];
    public readonly cancels: Array<CancelLotParams> = [];
    public readonly saleFees: Array<SetSaleFeeParams> = [];
    public readonly saleFeeReads: Array<GetSaleFeeParams> = [];
    public readonly saleQuotes: Array<QuoteSaleParams> = [];
    public readonly buyQuotes: Array<QuoteBuyParams> = [];
    public readonly reclaims: Array<ReclaimLotParams> = [];
    public readonly evictions: Array<EvictLotParams> = [];
    public readonly lotReads: Array<GetLotParams> = [];
    public readonly returnQuotes: Array<QuoteReturnParams> = [];
    private readonly onChainLot: OnChainLot = {
        seller: WALLET_ADDRESS,
        hub: 20n,
        resource: 3,
        remaining: 100n,
        pricePerUnit: parseEther('0.5'),
        state: OnChainLotState.Open,
        maxSaleFeeBp: 5000,
        hubRadius: 5,
        hubMoveFee: 0n,
    };
    private readonly tradeConfig: OnChainTradeConfig = {
        minPricePerUnit: 0n,
        saleBurnPercent: 1,
        minLotShareBp: 10,
        maxLotShareBp: 200,
        maxLotsPerSellerResource: 5,
        minUncappedLotValue: 10_000n,
        maxUncappedLotValue: 100_000n,
    };
    constructor(
        private readonly liveSaleFeeBp: number = 0,
        private readonly createError: Error | null = null,
        private readonly buyError: Error | null = null,
        private readonly saleQuote: SaleQuoteResult = fakeSaleQuote(),
        private readonly buyQuote: BuyQuoteResult = fakeBuyQuote(),
        private readonly quoteError: Error | null = null,
    ) {}
    async createLot(p: CreateLotParams): Promise<Hash> {
        this.creates.push(p);
        if (this.createError !== null) {
            throw this.createError;
        }
        return CREATE_HASH;
    }
    async buy(p: BuyLotParams): Promise<Hash> {
        this.buys.push(p);
        if (this.buyError !== null) {
            throw this.buyError;
        }
        return BUY_HASH;
    }
    async cancel(p: CancelLotParams): Promise<Hash> {
        this.cancels.push(p);
        return CANCEL_HASH;
    }
    async setSaleFee(p: SetSaleFeeParams): Promise<Hash> {
        this.saleFees.push(p);
        return SET_FEE_HASH;
    }
    async getSaleFee(p: GetSaleFeeParams): Promise<number> {
        this.saleFeeReads.push(p);
        return this.liveSaleFeeBp;
    }
    async quoteSale(p: QuoteSaleParams): Promise<SaleQuoteResult> {
        this.saleQuotes.push(p);
        if (this.quoteError !== null) {
            throw this.quoteError;
        }
        return this.saleQuote;
    }
    async quoteBuy(p: QuoteBuyParams): Promise<BuyQuoteResult> {
        this.buyQuotes.push(p);
        if (this.quoteError !== null) {
            throw this.quoteError;
        }
        return this.buyQuote;
    }
    async reclaim(p: ReclaimLotParams): Promise<Hash> {
        this.reclaims.push(p);
        return RECLAIM_HASH;
    }
    async evict(p: EvictLotParams): Promise<Hash> {
        this.evictions.push(p);
        return EVICT_HASH;
    }
    async getLot(p: GetLotParams): Promise<OnChainLot> {
        this.lotReads.push(p);
        return this.onChainLot;
    }
    async getLots(p: GetLotsParams): Promise<Array<OnChainLot>> {
        return p.lotIds.map(() => this.onChainLot);
    }
    async getConfig(_p: GetTradeConfigParams): Promise<OnChainTradeConfig> {
        return this.tradeConfig;
    }
    async getMinLotValue(_p: LotBoundParams): Promise<bigint> {
        return 0n;
    }
    async getMaxLotValue(_p: LotBoundParams): Promise<bigint> {
        return 0n;
    }
    async getSellerLotCount(_p: SellerLotCountParams): Promise<bigint> {
        return 0n;
    }
    async getSellerEvictedCount(_p: SellerEvictedCountParams): Promise<bigint> {
        return 0n;
    }
    async quoteReturn(p: QuoteReturnParams): Promise<ReturnQuoteResult> {
        this.returnQuotes.push(p);
        return { transitFee: 0n, transitDiscount: 0n, totalDistance: 0n, arrivalAt: 0n, amount: 0n };
    }
}

class FakeTransportClient implements ITransportClient {
    public readonly quotes: Array<QuoteRouteParams> = [];
    constructor(
        private readonly quoteResult: RouteQuote,
        private readonly quoteError: Error | null = null,
    ) {}
    async quoteRoute(p: QuoteRouteParams): Promise<RouteQuote> {
        this.quotes.push(p);
        if (this.quoteError !== null) {
            throw this.quoteError;
        }
        return this.quoteResult;
    }
    async move(_p: MoveParams): Promise<Hash> {
        throw new Error('unused');
    }
    async finalize(_p: FinalizeParams): Promise<Hash> {
        throw new Error('unused');
    }
}

type Options = Partial<{
    quote: RouteQuote;
    quoteError: Error | null;
    confirmLogs: Array<Log>;
    reverts: boolean;
    approve: Hash | null | Error;
    walletChainId: number;
    config: ReturnType<typeof makeConfig>;
    response: { status: number; data: unknown };
    liveSaleFeeBp: number;
    createError: Error | null;
    buyError: Error | null;
    saleQuote: SaleQuoteResult;
    buyQuote: BuyQuoteResult;
    tradeQuoteError: Error | null;
}>;

function makeTrade(opts: Options = {}): {
    service: TradeService;
    api: FakeApi;
    wallet: FakeWallet;
    allowance: FakeAllowance;
    contracts: FakeContractClient;
    tradeClient: FakeTradeClient;
    transportClient: FakeTransportClient;
} {
    const api = new FakeApi(opts.response ?? { status: 200, data: null });
    const wallet = new FakeWallet(opts.walletChainId ?? 1);
    const allowance = new FakeAllowance(opts.approve ?? null);
    const contracts = new FakeContractClient(opts.confirmLogs ?? [], opts.reverts ?? false);
    const tradeClient = new FakeTradeClient(
        opts.liveSaleFeeBp ?? 0,
        opts.createError ?? null,
        opts.buyError ?? null,
        opts.saleQuote ?? fakeSaleQuote(),
        opts.buyQuote ?? fakeBuyQuote(),
        opts.tradeQuoteError ?? null,
    );
    const transportClient = new FakeTransportClient(
        opts.quote ?? { totalFee: 0n, discount: 0n, totalDistance: 2n, arrivalAt: 1704n },
        opts.quoteError ?? null,
    );
    const service = new TradeService({
        api: api as unknown as ApiClient,
        wallet: wallet as unknown as WalletProvider,
        appConfig: new FakeAppConfig(opts.config ?? makeConfig()),
        allowance,
        contracts,
        tradeClient,
        transportClient,
        logger: new NoopLogger(),
    });
    return { service, api, wallet, allowance, contracts, tradeClient, transportClient };
}

describe('TradeService.createLot', () => {
    it('lists an own-cell route, locks the live rate in as tolerance, and decodes it back', async () => {
        const h = makeTrade({
            quote: { totalFee: 0n, discount: 0n, totalDistance: 2n, arrivalAt: 1704n },
            liveSaleFeeBp: 250,
            confirmLogs: [createdLog({ lotId: 7n, hub: 20n, maxSaleFeeBp: 250 }), scheduledLog(123n, 1704n)],
        });

        const result = await h.service.createLot(CREATE_INPUT);

        expect(h.tradeClient.saleFeeReads[0]).toMatchObject({ trade: TRADE, hub: 73n, res: 3 });
        expect(h.allowance.calls).toHaveLength(0);
        expect(h.tradeClient.creates).toHaveLength(1);
        expect(h.tradeClient.creates[0]).toMatchObject({
            trade: TRADE,
            res: 3,
            value: 100n,
            price: parseEther('0.5'),
            maxSaleFeeBp: 250,
            maxFee: 0n,
        });
        expect(result.lotId).toBe('7');
        expect(result.hubTokenId).toBe('20');
        expect(result.maxSaleFeePercent).toBe(2.5);
        expect(result.deliveryId).toBe('123');
        expect(result.fee).toBe('0');
        expect(result.transitPaid).toBe('0');
        expect(result.transitDiscount).toBe('0');
        expect(result.txHash).toBe(CREATE_HASH);
    });

    it('passes an explicit tolerance through and does not read the live rate', async () => {
        const h = makeTrade({
            liveSaleFeeBp: 999,
            confirmLogs: [createdLog({ lotId: 7n, hub: 20n, maxSaleFeeBp: 500 }), scheduledLog(123n, 1704n)],
        });

        const result = await h.service.createLot({ ...CREATE_INPUT, maxSaleFeePercent: 5 });

        expect(h.tradeClient.saleFeeReads).toHaveLength(0);
        expect(h.tradeClient.creates[0]?.maxSaleFeeBp).toBe(500);
        expect(result.maxSaleFeePercent).toBe(5);
    });

    it('rejects a sub-basis-point tolerance before sending', async () => {
        const h = makeTrade();
        await expect(h.service.createLot({ ...CREATE_INPUT, maxSaleFeePercent: 0.005 })).rejects.toThrow(
            /basis point/i,
        );
        expect(h.tradeClient.creates).toHaveLength(0);
    });

    it('rewrites a SaleFeeExceedsMax revert into a re-read-the-rate hint', async () => {
        const h = makeTrade({
            createError: new Error('Execution reverted: SaleFeeExceedsMax()'),
        });
        await expect(h.service.createLot({ ...CREATE_INPUT, maxSaleFeePercent: 1 })).rejects.toThrow(
            /re-read the hub's current rate/i,
        );
    });

    it('approves the buffered transit fee to Transport for a foreign-hub route', async () => {
        const h = makeTrade({
            quote: { totalFee: 1_000n, discount: 0n, totalDistance: 4n, arrivalAt: 1704n },
            approve: APPROVE_HASH,
            confirmLogs: [createdLog({ lotId: 7n, hub: 20n, maxSaleFeeBp: 0 }), scheduledLog(123n, 1704n)],
        });

        const result = await h.service.createLot(CREATE_INPUT);

        expect(h.allowance.calls).toEqual([{ token: CPU_TOKEN, spender: TRANSPORT, needed: 1_100n }]);
        expect(h.tradeClient.creates[0]?.maxFee).toBe(1_100n);
        expect(result.fee).toBe(formatEther(1_000n));
        expect(result.transitPaid).toBe(formatEther(1_000n));
        expect(result.transitDiscount).toBe('0');
        expect(result.approveTxHash).toBe(APPROVE_HASH);
    });

    it('refuses on a chain mismatch before quoting', async () => {
        const h = makeTrade({ walletChainId: 8453 });
        await expect(h.service.createLot(CREATE_INPUT)).rejects.toThrow(/chain mismatch/i);
        expect(h.transportClient.quotes).toHaveLength(0);
        expect(h.tradeClient.creates).toHaveLength(0);
    });

    it('throws when the Trade contract is not configured', async () => {
        const base = makeConfig();
        const config = { ...base, contracts: { ...base.contracts, trade: '' } };
        const h = makeTrade({ config });
        await expect(h.service.createLot(CREATE_INPUT)).rejects.toThrow(/not configured/i);
        expect(h.tradeClient.creates).toHaveLength(0);
    });

    it('throws when the create reverts on-chain', async () => {
        const h = makeTrade({ reverts: true });
        await expect(h.service.createLot(CREATE_INPUT)).rejects.toThrow(/reverted/i);
    });
});

describe('TradeService.setSaleFee', () => {
    it('converts percent to bp, sends the write, and decodes the confirmed rate', async () => {
        const h = makeTrade({
            confirmLogs: [saleFeeChangedLog({ hub: 20n, resource: 3, feeBp: 250 })],
        });

        const result = await h.service.setSaleFee({ hubTokenId: '20', resourceId: 3, feePercent: 2.5 });

        expect(h.allowance.calls).toHaveLength(0);
        expect(h.tradeClient.saleFees[0]).toMatchObject({ trade: TRADE, hub: 20n, res: 3, feeBp: 250 });
        expect(result.hubTokenId).toBe('20');
        expect(result.resourceId).toBe(3);
        expect(result.feePercent).toBe(2.5);
        expect(result.txHash).toBe(SET_FEE_HASH);
        expect(result.status).toBe(TxStatus.Success);
    });

    it('accepts a free (0%) rate', async () => {
        const h = makeTrade({ confirmLogs: [saleFeeChangedLog({ hub: 20n, resource: 3, feeBp: 0 })] });
        const result = await h.service.setSaleFee({ hubTokenId: '20', resourceId: 3, feePercent: 0 });
        expect(h.tradeClient.saleFees[0]?.feeBp).toBe(0);
        expect(result.feePercent).toBe(0);
    });

    it('rejects a sub-basis-point rate before sending', async () => {
        const h = makeTrade();
        await expect(h.service.setSaleFee({ hubTokenId: '20', resourceId: 3, feePercent: 0.005 })).rejects.toThrow(
            /basis point/i,
        );
        expect(h.tradeClient.saleFees).toHaveLength(0);
    });
});

describe('TradeService.buyLot', () => {
    it('decodes the sale-leg clan economics on a nonzero syndicate split', async () => {
        const h = makeTrade({
            response: {
                status: 200,
                data: lotView({ id: '7', pricePerUnit: '0.5', remaining: '100' }),
            },
            quote: { totalFee: 1_000n, discount: 0n, totalDistance: 4n, arrivalAt: 1704n },
            approve: APPROVE_HASH,
            confirmLogs: [
                boughtLog({
                    lotId: 7n,
                    value: 10n,
                    remaining: 90n,
                    sale: parseEther('5'),
                    hubFee: parseEther('0.125'),
                    burn: parseEther('0.05'),
                    discount: parseEther('0.2'),
                    tax: parseEther('0.03'),
                    ownerNet: parseEther('0.095'),
                    buyerSyndicateId: 42n,
                    ownerSyndicateId: 42n,
                    taxTo: WALLET_ADDRESS,
                    settledAt: 1704n,
                }),
                transitSettledLog({
                    deliveryId: 123n,
                    owner: FOREIGN_OWNER,
                    gross: parseEther('0.6'),
                    discount: parseEther('0.1'),
                }),
                transitSettledLog({
                    deliveryId: 123n,
                    owner: WALLET_ADDRESS,
                    gross: parseEther('0.5'),
                    discount: parseEther('0.05'),
                }),
                scheduledLog(123n, 1704n),
            ],
        });

        const result = await h.service.buyLot({
            lotId: '7',
            chain: [20, 75],
            value: '10',
        });

        expect(h.api.calls[0]?.path).toBe('/api/v1/trade/lots/7');
        expect(h.api.calls[0]?.authenticated).toBe(false);
        expect(h.allowance.calls).toEqual([
            { token: CPU_TOKEN, spender: TRADE, needed: parseEther('5') },
            { token: CPU_TOKEN, spender: TRANSPORT, needed: 1_100n },
        ]);
        expect(h.tradeClient.buys[0]).toMatchObject({ trade: TRADE, lotId: 7n, value: 10n, maxFee: 1_100n });
        expect(result.sale).toBe('5');
        expect(result.discount).toBe('0.2');
        expect(result.paid).toBe('4.8');
        expect(result.transitPaid).toBe('0.95');
        expect(result.transitDiscount).toBe('0.15');
        expect(result.hubFee).toBe('0.125');
        expect(result.tax).toBe('0.03');
        expect(result.ownerNet).toBe('0.095');
        expect(result.burn).toBe('0.05');
        expect(result.remaining).toBe('90');
        expect(result.fee).toBe(formatEther(1_000n));
        expect(result.deliveryId).toBe('123');
        expect(result.approveSaleTxHash).toBe(APPROVE_HASH);
        expect(result.approveTransitTxHash).toBe(APPROVE_HASH);
        expect(result.txHash).toBe(BUY_HASH);
        expect(result).not.toHaveProperty('buyerSyndicateId');
        expect(result).not.toHaveProperty('ownerSyndicateId');
        expect(result).not.toHaveProperty('taxTo');
        expect(result).not.toHaveProperty('settledAt');
    });

    it('skips the transit approve on a free route but still approves the sale', async () => {
        const h = makeTrade({
            response: {
                status: 200,
                data: lotView({ id: '7', pricePerUnit: '0.5', remaining: '100' }),
            },
            quote: { totalFee: 0n, discount: 0n, totalDistance: 2n, arrivalAt: 1704n },
            approve: APPROVE_HASH,
            confirmLogs: [
                boughtLog({
                    lotId: 7n,
                    value: 10n,
                    remaining: 90n,
                    sale: parseEther('5'),
                    hubFee: parseEther('0.125'),
                    burn: parseEther('0.05'),
                    discount: 0n,
                    tax: 0n,
                    ownerNet: parseEther('0.075'),
                    buyerSyndicateId: 0n,
                    ownerSyndicateId: 0n,
                    taxTo: zeroAddress,
                    settledAt: 1704n,
                }),
                scheduledLog(123n, 1704n),
            ],
        });

        const result = await h.service.buyLot({
            lotId: '7',
            chain: [20, 21],
            value: '10',
        });

        expect(h.allowance.calls).toEqual([{ token: CPU_TOKEN, spender: TRADE, needed: parseEther('5') }]);
        expect(result.approveTransitTxHash).toBeNull();
        expect(result.approveSaleTxHash).toBe(APPROVE_HASH);
        expect(result.discount).toBe('0');
        expect(result.tax).toBe('0');
        expect(result.paid).toBe(result.sale);
        expect(result.paid).toBe('5');
        expect(result.transitPaid).toBe('0');
        expect(result.transitDiscount).toBe('0');
    });

    it('sends the buy on a frozen lot and enriches the SaleFeeExceedsMax revert with the next moves', async () => {
        const h = makeTrade({
            response: { status: 200, data: lotView({ id: '7', saleFeeBp: 600, maxSaleFeeBp: 500 }) },
            quote: { totalFee: 0n, discount: 0n, totalDistance: 2n, arrivalAt: 1704n },
            approve: APPROVE_HASH,
            buyError: new Error('Execution reverted: SaleFeeExceedsMax()'),
        });

        await expect(h.service.buyLot({ lotId: '7', chain: [20, 21], value: '10' })).rejects.toThrow(
            /this lot is frozen.*seller can\s+send the remainder home.*paying no sale fee but still paying transit/is,
        );
        expect(h.tradeClient.buys).toHaveLength(1);
    });
});

describe('TradeService.cancelLot', () => {
    it('reads the lot remaining, routes it home, and decodes the cancel, scaling the contract-sourced fees', async () => {
        const h = makeTrade({
            response: { status: 200, data: lotView({ id: '7', remaining: '100' }) },
            quote: { totalFee: parseEther('0.3'), discount: 0n, totalDistance: 2n, arrivalAt: 1704n },
            confirmLogs: [
                cancelledLog({ lotId: 7n, returned: 100n }),
                transitSettledLog({
                    deliveryId: 123n,
                    owner: WALLET_ADDRESS,
                    gross: parseEther('0.3'),
                    discount: parseEther('0.05'),
                }),
                scheduledLog(123n, 1704n),
            ],
            approve: APPROVE_HASH,
        });

        const result = await h.service.cancelLot({
            lotId: '7',
            chain: [20, 72],
        });

        expect(h.allowance.calls).toEqual([{ token: CPU_TOKEN, spender: TRANSPORT, needed: parseEther('0.33') }]);
        expect(h.tradeClient.cancels[0]).toMatchObject({ trade: TRADE, lotId: 7n, maxFee: parseEther('0.33') });
        expect(h.transportClient.quotes[0]?.amount).toBe(100n);
        expect(result.returned).toBe('100');
        expect(result.fee).toBe('0.3');
        expect(result.transitPaid).toBe('0.25');
        expect(result.transitDiscount).toBe('0.05');
        expect(result.deliveryId).toBe('123');
        expect(result.approveTxHash).toBe(APPROVE_HASH);
        expect(result.txHash).toBe(CANCEL_HASH);
    });
});

describe('TradeService.quoteBuy', () => {
    it('preflights a routed buy through quoteBuy (sale leg + transit) and sends no transaction', async () => {
        const h = makeTrade({
            response: { status: 200, data: lotView({ id: '7', remaining: '100' }) },
            buyQuote: fakeBuyQuote({
                sale: fakeSaleQuote({
                    sale: parseEther('5'),
                    buyerTotal: parseEther('4.9'),
                    feeBp: 300,
                    discount: parseEther('0.1'),
                }),
                transitFee: 1_000n,
                transitDiscount: 40n,
                arrivalAt: 1704n,
                totalCost: parseEther('4.9') + 1_000n,
            }),
        });

        const result = await h.service.quoteBuy({ lotId: '7', value: '10', chain: [20, 75] });

        expect(h.tradeClient.buyQuotes).toHaveLength(1);
        expect(h.tradeClient.buyQuotes[0]).toMatchObject({
            trade: TRADE,
            lotId: 7n,
            value: 10n,
            destTokenIds: [20n, 75n],
            buyer: WALLET_ADDRESS,
        });
        expect(h.transportClient.quotes).toHaveLength(0);
        expect(h.tradeClient.saleQuotes).toHaveLength(0);
        expect(result.routed).toBe(true);
        expect(result.saleFeePercent).toBe(3);
        expect(result.sale).toBe('5');
        expect(result.salePaid).toBe('4.9');
        expect(result.transitFee).toBe(formatEther(1_000n));
        expect(result.transitDiscount).toBe(formatEther(40n));
        expect(result.total).toBe(formatEther(parseEther('4.9') + 1_000n));
        expect(result.arrivalAt).toBe(1704);
        expect(h.tradeClient.buys).toHaveLength(0);
    });

    it('gives a seller-only estimate via quoteSale with the buyer passed explicitly', async () => {
        const h = makeTrade({
            response: { status: 200, data: lotView({ id: '7', remaining: '100' }) },
            saleQuote: fakeSaleQuote({ sale: parseEther('5'), buyerTotal: parseEther('5'), feeBp: 250 }),
        });

        const result = await h.service.quoteBuy({ lotId: '7', value: '10', chain: null });

        expect(h.tradeClient.saleQuotes).toHaveLength(1);
        expect(h.tradeClient.saleQuotes[0]).toMatchObject({
            trade: TRADE,
            lotId: 7n,
            value: 10n,
            buyer: WALLET_ADDRESS,
        });
        expect(h.tradeClient.buyQuotes).toHaveLength(0);
        expect(h.transportClient.quotes).toHaveLength(0);
        expect(result.routed).toBe(false);
        expect(result.transitFee).toBeNull();
        expect(result.transitDiscount).toBeNull();
        expect(result.arrivalAt).toBeNull();
        expect(result.sale).toBe('5');
        expect(result.total).toBe('5');
    });

    it('carries the lot fractional $CPU price through into the quote unchanged', async () => {
        const h = makeTrade({
            response: { status: 200, data: lotView({ id: '7', pricePerUnit: '0.4', remaining: '100' }) },
            saleQuote: fakeSaleQuote({ sale: parseEther('5'), buyerTotal: parseEther('5'), feeBp: 250 }),
        });

        const result = await h.service.quoteBuy({ lotId: '7', value: '10', chain: null });

        expect(result.pricePerUnit).toBe('0.4');
    });

    it('surfaces a zero split and the buyer-total intact', async () => {
        const h = makeTrade({
            response: { status: 200, data: lotView({ id: '7', remaining: '100' }) },
            saleQuote: fakeSaleQuote({
                sale: parseEther('5'),
                buyerTotal: parseEther('5'),
                feeBp: 0,
                discount: 0n,
                tax: 0n,
                ownerNet: 0n,
            }),
        });

        const result = await h.service.quoteBuy({ lotId: '7', value: '10', chain: null });

        expect(result.saleFeePercent).toBe(0);
        expect(result.discount).toBe('0');
        expect(result.tax).toBe('0');
        expect(result.ownerNet).toBe('0');
        expect(result.salePaid).toBe('5');
    });

    it('surfaces a non-zero clan split — discount, tax, ownerNet — from the contract quote', async () => {
        const h = makeTrade({
            response: { status: 200, data: lotView({ id: '7', remaining: '100' }) },
            saleQuote: fakeSaleQuote({
                sale: parseEther('5'),
                buyerTotal: parseEther('4.75'),
                feeBp: 500,
                hubFee: parseEther('0.25'),
                discount: parseEther('0.25'),
                tax: parseEther('0.05'),
                ownerNet: parseEther('0.2'),
            }),
        });

        const result = await h.service.quoteBuy({ lotId: '7', value: '10', chain: null });

        expect(result.saleFeePercent).toBe(5);
        expect(result.discount).toBe('0.25');
        expect(result.salePaid).toBe('4.75');
        expect(result.tax).toBe('0.05');
        expect(result.ownerNet).toBe('0.2');
        expect(result.total).toBe('4.75');
    });

    it('translates a reverted quote into a human reason and refuses', async () => {
        const h = makeTrade({
            response: { status: 200, data: lotView({ id: '7', remaining: '100' }) },
            tradeQuoteError: new Error('Quote reverted: ExceedsRemaining()'),
        });

        await expect(h.service.quoteBuy({ lotId: '7', value: '999', chain: null })).rejects.toThrow(
            /won't go through: the amount exceeds the lot's remaining units/,
        );
    });

    it('names a foreign frozen hub on the route from a bubbled transport revert', async () => {
        const h = makeTrade({
            response: { status: 200, data: lotView({ id: '7', remaining: '100' }) },
            tradeQuoteError: new Error('Quote reverted: NotEligibleWaypoint()'),
        });

        await expect(h.service.quoteBuy({ lotId: '7', value: '10', chain: [20, 75] })).rejects.toThrow(
            /foreign frozen hub blocks the path/,
        );
    });
});

describe('TradeService reads', () => {
    it('listMyLots hits the authenticated mine endpoint and converts the frozen fee to percent', async () => {
        const h = makeTrade({ response: { status: 200, data: [lotView({ id: '1', saleFeeBp: 250 })] } });

        const result = await h.service.listMyLots(null);

        expect(h.api.calls[0]?.path).toBe('/api/v1/trade/lots/mine');
        expect(h.api.calls[0]?.authenticated).toBe(true);
        expect(result[0]?.id).toBe('1');
        expect(result[0]?.saleFeePercent).toBe(2.5);
    });

    it("drops the API's legacy tradeFeePct placeholder from lot output", async () => {
        const raw = { ...lotView({ id: '1' }), tradeFeePct: 0 } as ApiLotView;
        const h = makeTrade({ response: { status: 200, data: [raw] } });

        const result = await h.service.listMyLots(null);

        expect(result[0]).not.toHaveProperty('tradeFeePct');
        expect(result[0]).toHaveProperty('saleFeePercent');
    });

    it('listLots hits the public lots endpoint', async () => {
        const h = makeTrade({ response: { status: 200, data: [lotView()] } });

        const result = await h.service.listLots({ ...LIST_QUERY });

        expect(h.api.calls[0]?.path.startsWith('/api/v1/trade/lots')).toBe(true);
        expect(h.api.calls[0]?.authenticated).toBe(false);
        expect(result).toHaveLength(1);
        expect(result[0]?.pricePerUnit).toBe('0.5');
    });

    it('exposes the tolerance percent and flags a lot whose live rate exceeds it as frozen', async () => {
        const h = makeTrade({ response: { status: 200, data: lotView({ saleFeeBp: 600, maxSaleFeeBp: 500 }) } });

        const lot = await h.service.getLot('7');

        expect(lot.saleFeePercent).toBe(6);
        expect(lot.maxSaleFeePercent).toBe(5);
        expect(lot.frozen).toBe(true);
    });

    it('does not flag a lot whose live rate equals the tolerance (equality is not frozen)', async () => {
        const h = makeTrade({ response: { status: 200, data: lotView({ saleFeeBp: 500, maxSaleFeeBp: 500 }) } });

        const lot = await h.service.getLot('7');

        expect(lot.frozen).toBe(false);
    });

    it('getLot does not hide a frozen lot — it returns it flagged', async () => {
        const h = makeTrade({
            response: { status: 200, data: lotView({ id: '9', saleFeeBp: 600, maxSaleFeeBp: 500 }) },
        });

        const lot = await h.service.getLot('9');

        expect(lot.id).toBe('9');
        expect(lot.frozen).toBe(true);
    });

    it('listMyLots carries the frozen flag per lot', async () => {
        const h = makeTrade({
            response: { status: 200, data: [lotView({ id: '1', saleFeeBp: 600, maxSaleFeeBp: 500 })] },
        });

        const result = await h.service.listMyLots(null);

        expect(result[0]?.frozen).toBe(true);
    });

    it('rejects a lot response missing the required maxSaleFeeBp — a missing tolerance is wire drift', async () => {
        const { maxSaleFeeBp: _dropped, ...noTolerance } = lotView();
        const h = makeTrade({ response: { status: 200, data: [noTolerance] } });

        await expect(h.service.listLots({ ...LIST_QUERY })).rejects.toThrow();
    });

    it('getMarkets passes through the frozen aggregates when the server serves them', async () => {
        const h = makeTrade({ response: { status: 200, data: [marketRow({ frozenLots: 1, frozenRemaining: '40' })] } });

        const rows = await h.service.getMarkets({ ...MARKETS_QUERY });

        expect(rows[0]?.frozenLots).toBe(1);
        expect(rows[0]?.frozenRemaining).toBe('40');
    });

    it('getMarkets rejects a market row missing the frozen aggregates — the deployed projection always serves them', async () => {
        const { frozenLots: _f, frozenRemaining: _r, ...noFrozen } = marketRow();
        const h = makeTrade({ response: { status: 200, data: [noFrozen] } });

        await expect(h.service.getMarkets({ ...MARKETS_QUERY })).rejects.toThrow();
    });
});

describe('TradeService money passthrough (API already sends $CPU decimal, not wei)', () => {
    it('listLots carries a fractional $CPU price through unchanged', async () => {
        const h = makeTrade({ response: { status: 200, data: [lotView({ pricePerUnit: '0.4' })] } });

        const result = await h.service.listLots({ ...LIST_QUERY });

        expect(result[0]?.pricePerUnit).toBe('0.4');
    });

    it('getLot carries a fractional $CPU price through unchanged', async () => {
        const h = makeTrade({ response: { status: 200, data: lotView({ pricePerUnit: '0.4' }) } });

        const lot = await h.service.getLot('7');

        expect(lot.pricePerUnit).toBe('0.4');
    });

    it('listMyLots carries a fractional $CPU price through unchanged', async () => {
        const h = makeTrade({ response: { status: 200, data: [lotView({ pricePerUnit: '0.4' })] } });

        const result = await h.service.listMyLots(null);

        expect(result[0]?.pricePerUnit).toBe('0.4');
    });

    it('getMarkets carries a fractional $CPU minPrice through unchanged', async () => {
        const h = makeTrade({ response: { status: 200, data: [marketRow({ minPricePerUnit: '0.4' })] } });

        const rows = await h.service.getMarkets({ ...MARKETS_QUERY });

        expect(rows[0]?.minPricePerUnit).toBe('0.4');
    });

    it('does not shrink a whole-number $CPU price by 1e18', async () => {
        const h = makeTrade({ response: { status: 200, data: [lotView({ pricePerUnit: '12' })] } });

        const result = await h.service.listLots({ ...LIST_QUERY });

        expect(result[0]?.pricePerUnit).toBe('12');
    });

    it('does not shrink a whole-number $CPU minPrice by 1e18', async () => {
        const h = makeTrade({ response: { status: 200, data: [marketRow({ minPricePerUnit: '12' })] } });

        const rows = await h.service.getMarkets({ ...MARKETS_QUERY });

        expect(rows[0]?.minPricePerUnit).toBe('12');
    });

    it('passes minPrice/maxPrice through to the request query exactly as given', async () => {
        const h = makeTrade({ response: { status: 200, data: [lotView()] } });

        await h.service.listLots({ ...LIST_QUERY, minPrice: '0.05', maxPrice: '12.5' });

        expect(h.api.calls[0]?.path).toContain('minPrice=0.05');
        expect(h.api.calls[0]?.path).toContain('maxPrice=12.5');
    });
});

describe('TradeService.listLots availability', () => {
    const frozenLot = (): ApiLotView => lotView({ id: 'f', saleFeeBp: 600, maxSaleFeeBp: 500 });
    const openLot = (): ApiLotView => lotView({ id: 'o', saleFeeBp: 100, maxSaleFeeBp: 500 });

    it('drops a frozen lot on the default path even if the server returns one', async () => {
        const h = makeTrade({ response: { status: 200, data: [openLot(), frozenLot()] } });

        const result = await h.service.listLots({ ...LIST_QUERY });

        expect(result.map((l) => l.id)).toEqual(['o']);
    });

    it('drops a frozen lot on an explicit availability=open', async () => {
        const h = makeTrade({ response: { status: 200, data: [openLot(), frozenLot()] } });

        const result = await h.service.listLots({ ...LIST_QUERY, availability: LotAvailability.Open });

        expect(result.map((l) => l.id)).toEqual(['o']);
    });

    it('returns frozen lots the server sends when availability=frozen', async () => {
        const h = makeTrade({ response: { status: 200, data: [frozenLot()] } });

        const result = await h.service.listLots({ ...LIST_QUERY, availability: LotAvailability.Frozen });

        expect(result.map((l) => l.id)).toEqual(['f']);
    });

    it('does not filter when availability=all', async () => {
        const h = makeTrade({ response: { status: 200, data: [openLot(), frozenLot()] } });

        const result = await h.service.listLots({ ...LIST_QUERY, availability: LotAvailability.All });

        expect(result.map((l) => l.id)).toEqual(['o', 'f']);
    });
});

describe('TradeService.listFills', () => {
    it('reads the public fills feed and maps a page', async () => {
        const h = makeTrade({ response: { status: 200, data: [fillRow()] } });

        const result = await h.service.listFills({ ...FILLS_QUERY });

        expect(h.api.calls[0]?.path.startsWith('/api/v1/trade/fills')).toBe(true);
        expect(h.api.calls[0]?.authenticated).toBe(false);
        expect(result).toHaveLength(1);
        expect(result[0]?.lotId).toBe('7');
        expect(result[0]?.blockNumber).toBe(1200);
        expect(result[0]?.logIndex).toBe(4);
    });

    it('returns the row exactly as it arrived, adding nothing but soldOut', async () => {
        const row = fillRow();
        const h = makeTrade({ response: { status: 200, data: [row] } });

        const result = await h.service.listFills({ ...FILLS_QUERY });

        expect(result[0]).toEqual({ ...row, soldOut: false });
    });

    it('puts the resource, hub and page size filters into the query string', async () => {
        const h = makeTrade({ response: { status: 200, data: [] } });

        await h.service.listFills({ ...FILLS_QUERY, resourceId: 3, hubTokenId: 20, limit: 25 });

        expect(h.api.calls[0]?.path).toContain('resourceId=3');
        expect(h.api.calls[0]?.path).toContain('hubTokenId=20');
        expect(h.api.calls[0]?.path).toContain('limit=25');
    });

    it('sends an out-of-range page size to the server untouched — no local clamp', async () => {
        const h = makeTrade({ response: { status: 200, data: [] } });

        await h.service.listFills({ ...FILLS_QUERY, limit: 500 });

        expect(h.api.calls[0]?.path).toContain('limit=500');
    });

    it('sends the cursor as the block:logIndex pair the server issued', async () => {
        const h = makeTrade({ response: { status: 200, data: [] } });

        await h.service.listFills({ ...FILLS_QUERY, before: '1200:4' });

        expect(h.api.calls[0]?.path).toContain(`before=${encodeURIComponent('1200:4')}`);
    });

    it('omits filters that were not asked for', async () => {
        const h = makeTrade({ response: { status: 200, data: [] } });

        await h.service.listFills({ ...FILLS_QUERY });

        expect(h.api.calls[0]?.path).toBe('/api/v1/trade/fills');
    });

    it('carries fractional $CPU money through as the exact strings the server sent', async () => {
        const h = makeTrade({
            response: {
                status: 200,
                data: [fillRow({ sale: '0.4', hubFee: '0.01', burn: '0.002', pricePerUnit: '0.04' })],
            },
        });

        const result = await h.service.listFills({ ...FILLS_QUERY });

        expect(result[0]?.sale).toBe('0.4');
        expect(result[0]?.hubFee).toBe('0.01');
        expect(result[0]?.burn).toBe('0.002');
        expect(result[0]?.pricePerUnit).toBe('0.04');
    });

    it('does not shrink whole-number $CPU money by 1e18', async () => {
        const h = makeTrade({
            response: { status: 200, data: [fillRow({ sale: '12', hubFee: '1', burn: '2', pricePerUnit: '3' })] },
        });

        const result = await h.service.listFills({ ...FILLS_QUERY });

        expect(result[0]?.sale).toBe('12');
        expect(result[0]?.hubFee).toBe('1');
        expect(result[0]?.burn).toBe('2');
        expect(result[0]?.pricePerUnit).toBe('3');
    });

    it('leaves the unit counts as the server sent them', async () => {
        const h = makeTrade({ response: { status: 200, data: [fillRow({ value: '25', remaining: '7' })] } });

        const result = await h.service.listFills({ ...FILLS_QUERY });

        expect(result[0]?.value).toBe('25');
        expect(result[0]?.remaining).toBe('7');
    });

    it('marks a fill that emptied the lot as sold out', async () => {
        const h = makeTrade({ response: { status: 200, data: [fillRow({ remaining: '0' })] } });

        const result = await h.service.listFills({ ...FILLS_QUERY });

        expect(result[0]?.soldOut).toBe(true);
    });

    it('does not mark a partial fill as sold out', async () => {
        const h = makeTrade({ response: { status: 200, data: [fillRow({ remaining: '90' })] } });

        const result = await h.service.listFills({ ...FILLS_QUERY });

        expect(result[0]?.soldOut).toBe(false);
    });

    it('keeps the server order — newest first, no re-sorting', async () => {
        const h = makeTrade({
            response: {
                status: 200,
                data: [
                    fillRow({ blockNumber: 1200, logIndex: 4 }),
                    fillRow({ blockNumber: 1199, logIndex: 9 }),
                    fillRow({ blockNumber: 1100, logIndex: 0 }),
                ],
            },
        });

        const result = await h.service.listFills({ ...FILLS_QUERY });

        expect(result.map((f) => `${f.blockNumber}:${f.logIndex}`)).toEqual(['1200:4', '1199:9', '1100:0']);
    });

    it('treats an empty page as an empty result, not an error', async () => {
        const h = makeTrade({ response: { status: 200, data: [] } });

        await expect(h.service.listFills({ ...FILLS_QUERY })).resolves.toEqual([]);
    });

    it('surfaces the server error text when the page is rejected', async () => {
        const h = makeTrade({ response: { status: 400, data: { message: 'must be a page size no larger than 200' } } });

        await expect(h.service.listFills({ ...FILLS_QUERY, limit: 500 })).rejects.toThrow(
            /must be a page size no larger than 200/,
        );
    });

    it('rejects a fill response missing a money field — wire drift is not silently absorbed', async () => {
        const { sale: _dropped, ...noSale } = fillRow();
        const h = makeTrade({ response: { status: 200, data: [noSale] } });

        await expect(h.service.listFills({ ...FILLS_QUERY })).rejects.toThrow();
    });
});

describe('TradeService.getMarketIndex', () => {
    it('reads the public index endpoint and parses the response', async () => {
        const h = makeTrade({
            response: { status: 200, data: { computedAt: 1700000000, resources: [marketIndexRow()] } },
        });

        const result = await h.service.getMarketIndex();

        expect(h.api.calls[0]?.path).toBe('/api/v1/trade/index');
        expect(h.api.calls[0]?.authenticated).toBe(false);
        expect(result.computedAt).toBe(1700000000);
        expect(result.resources).toHaveLength(1);
        expect(result.resources[0]?.resourceId).toBe(3);
    });

    it('carries a fractional $CPU VWAP through unchanged', async () => {
        const h = makeTrade({
            response: {
                status: 200,
                data: { computedAt: 1700000000, resources: [marketIndexRow({ priceCpu: '0.123456789012345678' })] },
            },
        });

        const result = await h.service.getMarketIndex();

        expect(result.resources[0]?.priceCpu).toBe('0.123456789012345678');
    });

    it('does not shrink a whole-number VWAP by 1e18', async () => {
        const h = makeTrade({
            response: {
                status: 200,
                data: { computedAt: 1700000000, resources: [marketIndexRow({ priceCpu: '12' })] },
            },
        });

        const result = await h.service.getMarketIndex();

        expect(result.resources[0]?.priceCpu).toBe('12');
    });

    it('leaves the 24h volume as the exact string the server sent — units are never rescaled by 1e18', async () => {
        const h = makeTrade({
            response: {
                status: 200,
                data: {
                    computedAt: 1700000000,
                    resources: [marketIndexRow({ volume: '400000000000000000000' })],
                },
            },
        });

        const result = await h.service.getMarketIndex();

        expect(result.resources[0]?.volume).toBe('400000000000000000000');
    });

    it('carries a fractional 24h volume through unchanged', async () => {
        const h = makeTrade({
            response: {
                status: 200,
                data: { computedAt: 1700000000, resources: [marketIndexRow({ volume: '0.000000000000000123' })] },
            },
        });

        const result = await h.service.getMarketIndex();

        expect(result.resources[0]?.volume).toBe('0.000000000000000123');
    });

    it('maps every row field straight off the wire, row for row', async () => {
        const rows = [
            marketIndexRow({ resourceId: 11, priceCpu: '0.5', changePct: 3.2, volume: '120', spark: ['0.4', '0.5'] }),
            marketIndexRow({ resourceId: 42, priceCpu: '7', changePct: -8.5, volume: '900', spark: [null, '1.25'] }),
            marketIndexRow({ resourceId: 7, priceCpu: null, changePct: null, volume: null, spark: [null] }),
        ];
        const h = makeTrade({ response: { status: 200, data: { computedAt: 1700000000, resources: rows } } });

        const result = await h.service.getMarketIndex();

        expect(result).toEqual({ computedAt: 1700000000, resources: rows });
    });

    it('a row with no trades survives mapping with every stat null, not zero', async () => {
        const noTrades = marketIndexRow({ priceCpu: null, changePct: null, volume: null, spark: [null, null, null] });
        const h = makeTrade({
            response: { status: 200, data: { computedAt: 1700000000, resources: [noTrades] } },
        });

        const result = await h.service.getMarketIndex();

        expect(result.resources[0]?.priceCpu).toBeNull();
        expect(result.resources[0]?.changePct).toBeNull();
        expect(result.resources[0]?.volume).toBeNull();
        expect(result.resources[0]?.spark).toEqual([null, null, null]);
    });

    it('carries the spark series through to the structured result, whatever its length', async () => {
        const spark = ['0.1', null, '0.3', '0.4', '0.5', '0.6', '0.7'];
        const h = makeTrade({
            response: { status: 200, data: { computedAt: 1700000000, resources: [marketIndexRow({ spark })] } },
        });

        const result = await h.service.getMarketIndex();

        expect(result.resources[0]?.spark).toEqual(spark);
    });

    it('does not pin the resource count — any number of rows parses', async () => {
        const h = makeTrade({
            response: {
                status: 200,
                data: {
                    computedAt: 1700000000,
                    resources: [marketIndexRow({ resourceId: 3 }), marketIndexRow({ resourceId: 5 })],
                },
            },
        });

        const result = await h.service.getMarketIndex();

        expect(result.resources).toHaveLength(2);
    });

    it('accepts more resources than the world holds today — a resource added on the server still arrives', async () => {
        const rows = Array.from({ length: 40 }, (_, i) => marketIndexRow({ resourceId: i + 1 }));
        const h = makeTrade({ response: { status: 200, data: { computedAt: 1700000000, resources: rows } } });

        const result = await h.service.getMarketIndex();

        expect(result.resources).toHaveLength(rows.length);
        expect(result.resources.map((row) => row.resourceId)).toEqual(rows.map((row) => row.resourceId));
    });

    it('accepts a spark series longer than a week of hours — a longer window still arrives whole', async () => {
        const spark = Array.from({ length: 90 }, (_, i) => `0.${i}`);
        const h = makeTrade({
            response: { status: 200, data: { computedAt: 1700000000, resources: [marketIndexRow({ spark })] } },
        });

        const result = await h.service.getMarketIndex();

        expect(result.resources[0]?.spark).toHaveLength(spark.length);
        expect(result.resources[0]?.spark).toEqual(spark);
    });

    it('tolerates unknown fields from a future server version', async () => {
        const h = makeTrade({
            response: {
                status: 200,
                data: {
                    computedAt: 1700000000,
                    resources: [{ ...marketIndexRow(), futureRowField: 'x' }],
                    futureTopField: 1,
                },
            },
        });

        await expect(h.service.getMarketIndex()).resolves.toBeDefined();
    });

    it('rejects an index response missing a required field — wire drift is not silently absorbed', async () => {
        const { priceCpu: _dropped, ...noPriceCpu } = marketIndexRow();
        const h = makeTrade({
            response: { status: 200, data: { computedAt: 1700000000, resources: [noPriceCpu] } },
        });

        await expect(h.service.getMarketIndex()).rejects.toThrow();
    });

    it('surfaces the server error text on a failed load', async () => {
        const h = makeTrade({ response: { status: 500, data: { message: 'index rebuild in progress' } } });

        await expect(h.service.getMarketIndex()).rejects.toThrow(/index rebuild in progress/);
    });
});
