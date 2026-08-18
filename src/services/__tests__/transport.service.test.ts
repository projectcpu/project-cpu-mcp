import {
    type Abi,
    type Address,
    encodeAbiParameters,
    encodeEventTopics,
    type Hash,
    type Log,
    parseAbiItem,
    parseEther,
} from 'viem';
import { describe, expect, it } from 'vitest';

import type { ApiClient } from '../../api/client.js';
import { DeliveryTargetKind, type DeliveryResponse } from '../../api/types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import {
    type ConfirmedTx,
    type IContractClient,
    type ReadContractParams,
    type TransactionRequest,
    TxStatus,
    type WalletProvider,
} from '../../wallet/types.js';
import { TransportService } from '../transport.service.js';
import {
    DeliveryFilter,
    type FinalizeParams,
    type ITransportClient,
    type MoveParams,
    type QuoteRouteParams,
    type RouteQuote,
} from '../types.js';
import {
    APPROVE_HASH,
    CPU_TOKEN,
    FakeAllowance,
    FakeApi,
    FakeAppConfig,
    FakeWallet,
    TRANSPORT,
    WALLET_ADDRESS,
    makeConfig,
    transitSettledLog,
} from './service-fakes.js';

const FOREIGN_OWNER = '0x00000000000000000000000000000000000000f1' as Address;
const DELIVERY_SCHEDULED_EVENT = parseAbiItem(
    'event DeliveryScheduled(uint256 indexed deliveryId, address indexed payer, uint256 sourceId, ' +
        'address receiver, uint256 targetId, uint16 resource, uint64 amount, uint64 arrivalAt, ' +
        'uint256[] waypoints, uint64 scheduledAt)',
);

const MOVE_HASH = `0x${'1'.repeat(64)}` as Hash;
const FINALIZE_HASH = `0x${'2'.repeat(64)}` as Hash;

const INPUT = {
    path: [72, 73],
    resourceId: 3,
    amount: '100',
};

function scheduledLog(args: { deliveryId: bigint; sourceId: bigint; targetId: bigint; arrivalAt: bigint }): Log {
    const topics = encodeEventTopics({
        abi: [DELIVERY_SCHEDULED_EVENT],
        eventName: 'DeliveryScheduled',
        args: { deliveryId: args.deliveryId, payer: WALLET_ADDRESS },
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
        [
            args.sourceId,
            WALLET_ADDRESS,
            args.targetId,
            3,
            100n,
            args.arrivalAt,
            [args.sourceId, args.targetId],
            1_700_000_000n,
        ],
    );
    return {
        address: TRANSPORT,
        topics,
        data,
        blockNumber: 100n,
        blockHash: `0x${'0'.repeat(64)}`,
        logIndex: 0,
        transactionHash: MOVE_HASH,
        transactionIndex: 0,
        removed: false,
    } as unknown as Log;
}

class FakeContractClient implements IContractClient {
    public readonly sent: Array<TransactionRequest> = [];
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
    async send(tx: TransactionRequest, _errorAbi: Abi | null): Promise<Hash> {
        this.sent.push(tx);
        return MOVE_HASH;
    }
    async confirm(hash: Hash, revertLabel: string): Promise<ConfirmedTx> {
        if (this.reverts) {
            throw new Error(`${revertLabel} reverted on-chain (tx ${hash}).`);
        }
        return { txHash: hash, status: TxStatus.Success, blockNumber: '100', logs: this.logs };
    }
}

class FakeTransportClient implements ITransportClient {
    public readonly quotes: Array<QuoteRouteParams> = [];
    public readonly moves: Array<MoveParams> = [];
    public readonly finalizes: Array<FinalizeParams> = [];
    constructor(
        private readonly quoteResult: RouteQuote,
        private readonly quoteError: Error | null = null,
    ) {}
    async quoteRoute(params: QuoteRouteParams): Promise<RouteQuote> {
        this.quotes.push(params);
        if (this.quoteError !== null) {
            throw this.quoteError;
        }
        return this.quoteResult;
    }
    async move(params: MoveParams): Promise<Hash> {
        this.moves.push(params);
        return MOVE_HASH;
    }
    async finalize(params: FinalizeParams): Promise<Hash> {
        this.finalizes.push(params);
        return FINALIZE_HASH;
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
}>;

function makeTransport(opts: Options = {}): {
    service: TransportService;
    api: FakeApi;
    wallet: FakeWallet;
    allowance: FakeAllowance;
    contracts: FakeContractClient;
    transportClient: FakeTransportClient;
} {
    const api = new FakeApi(opts.response ?? { status: 200, data: { serverTime: 0, version: 0, deliveries: [] } });
    const wallet = new FakeWallet(opts.walletChainId ?? 1);
    const allowance = new FakeAllowance(opts.approve ?? null);
    const contracts = new FakeContractClient(opts.confirmLogs ?? [], opts.reverts ?? false);
    const transportClient = new FakeTransportClient(
        opts.quote ?? { totalFee: 0n, discount: 0n, totalDistance: 2n, arrivalAt: 1704n },
        opts.quoteError ?? null,
    );
    const service = new TransportService({
        api: api as unknown as ApiClient,
        wallet: wallet as unknown as WalletProvider,
        appConfig: new FakeAppConfig(opts.config ?? makeConfig()),
        allowance,
        contracts,
        transportClient,
        logger: new NoopLogger(),
    });
    return { service, api, wallet, allowance, contracts, transportClient };
}

function delivery(over: Partial<DeliveryResponse> = {}): DeliveryResponse {
    return {
        deliveryId: '123',
        payer: WALLET_ADDRESS,
        receiver: '0x5555555555555555555555555555555555555555',
        sourceTokenId: '10',
        targetTokenId: '20',
        targetKind: DeliveryTargetKind.Cell,
        resourceId: 3,
        amount: '100',
        arrivalAt: 1,
        delivered: false,
        updated: 1000,
        ...over,
    };
}

describe('TransportService.transport', () => {
    it('moves an own-cell route with no $CPU fee and decodes the delivery', async () => {
        const h = makeTransport({
            quote: { totalFee: 0n, discount: 0n, totalDistance: 2n, arrivalAt: 1704n },
            confirmLogs: [scheduledLog({ deliveryId: 123n, sourceId: 10n, targetId: 20n, arrivalAt: 1704n })],
        });

        const result = await h.service.transport(INPUT);

        expect(h.allowance.calls).toHaveLength(0);
        expect(h.transportClient.moves).toHaveLength(1);
        expect(h.transportClient.moves[0]?.maxFee).toBe(0n);
        expect(h.transportClient.moves[0]?.res).toBe(3);
        expect(h.transportClient.moves[0]?.amount).toBe(100n);
        expect(result.deliveryId).toBe('123');
        expect(result.sourceTokenId).toBe('10');
        expect(result.targetTokenId).toBe('20');
        expect(result.fee).toBe('0');
        expect(result.transitPaid).toBe('0');
        expect(result.transitDiscount).toBe('0');
        expect(result.arrivalAt).toBe(1704);
        expect(result.approveTxHash).toBeNull();
        expect(result.txHash).toBe(MOVE_HASH);
        expect(result.blockNumber).toBe('100');
        expect(result.status).toBe(TxStatus.Success);
    });

    it('approves the buffered maxFee to the Transport contract for a paid route', async () => {
        const h = makeTransport({
            quote: { totalFee: 1_000n, discount: 250n, totalDistance: 4n, arrivalAt: 1704n },
            approve: APPROVE_HASH,
            confirmLogs: [scheduledLog({ deliveryId: 5n, sourceId: 10n, targetId: 20n, arrivalAt: 1704n })],
        });

        const result = await h.service.transport(INPUT);

        expect(h.allowance.calls).toEqual([{ token: CPU_TOKEN, spender: TRANSPORT, needed: 1_100n }]);
        expect(h.transportClient.moves[0]?.maxFee).toBe(1_100n);
        expect(result.fee).toBe('0.000000000000001');
        expect(result.transitPaid).toBe('0.000000000000001');
        expect(result.transitDiscount).toBe('0');
        expect(result.approveTxHash).toBe(APPROVE_HASH);
    });

    it('aggregates the settled transit legs into transitPaid and transitDiscount', async () => {
        const h = makeTransport({
            quote: { totalFee: parseEther('0.95'), discount: parseEther('0.15'), totalDistance: 4n, arrivalAt: 1704n },
            approve: APPROVE_HASH,
            confirmLogs: [
                scheduledLog({ deliveryId: 5n, sourceId: 10n, targetId: 20n, arrivalAt: 1704n }),
                transitSettledLog({
                    deliveryId: 5n,
                    owner: FOREIGN_OWNER,
                    gross: parseEther('0.6'),
                    discount: parseEther('0.1'),
                }),
                transitSettledLog({
                    deliveryId: 5n,
                    owner: WALLET_ADDRESS,
                    gross: parseEther('0.5'),
                    discount: parseEther('0.05'),
                }),
            ],
        });

        const result = await h.service.transport(INPUT);

        expect(result.transitPaid).toBe('0.95');
        expect(result.transitDiscount).toBe('0.15');
    });

    it('refuses on a chain mismatch before quoting', async () => {
        const h = makeTransport({ walletChainId: 8453 });
        await expect(h.service.transport(INPUT)).rejects.toThrow(/chain mismatch/i);
        expect(h.transportClient.quotes).toHaveLength(0);
    });

    it('throws when the Transport contract is not configured', async () => {
        const base = makeConfig();
        const config = { ...base, contracts: { ...base.contracts, transport: '' } };
        const h = makeTransport({ config });
        await expect(h.service.transport(INPUT)).rejects.toThrow(/not configured/i);
        expect(h.transportClient.quotes).toHaveLength(0);
    });

    it('surfaces a route rejection from quoteRoute and sends no move', async () => {
        const h = makeTransport({ quoteError: new Error('HopOutOfRange') });
        await expect(h.service.transport(INPUT)).rejects.toThrow(/HopOutOfRange/);
        expect(h.transportClient.moves).toHaveLength(0);
    });

    it('throws when the move reverts on-chain', async () => {
        const h = makeTransport({
            quote: { totalFee: 0n, discount: 0n, totalDistance: 2n, arrivalAt: 1704n },
            reverts: true,
        });
        await expect(h.service.transport(INPUT)).rejects.toThrow(/reverted/i);
    });
});

describe('TransportService.quote', () => {
    it('previews a route via the on-chain view without any transaction', async () => {
        const h = makeTransport({ quote: { totalFee: 10n, discount: 4n, totalDistance: 6n, arrivalAt: 1704n } });

        const result = await h.service.quote(INPUT);

        expect(h.transportClient.quotes).toHaveLength(1);
        expect(result.fee).toBe('0.00000000000000001');
        expect(result.discount).toBe('0.000000000000000004');
        expect(result.totalDistance).toBe(6);
        expect(result.arrivalAt).toBe(1704);
        expect(h.contracts.sent).toHaveLength(0);
    });

    it('surfaces a route rejection', async () => {
        const h = makeTransport({ quoteError: new Error('NotEligibleWaypoint') });
        await expect(h.service.quote(INPUT)).rejects.toThrow(/NotEligibleWaypoint/);
    });
});

describe('TransportService.finalize', () => {
    it('finalizes the given delivery ids via finalizeMany', async () => {
        const h = makeTransport();

        const result = await h.service.finalize(['1', '2']);

        expect(h.transportClient.finalizes).toEqual([{ transport: TRANSPORT, ids: [1n, 2n] }]);
        expect(result.deliveryIds).toEqual(['1', '2']);
        expect(result.txHash).toBe(FINALIZE_HASH);
        expect(result.blockNumber).toBe('100');
    });
});

describe('TransportService reads', () => {
    it('listMine queries the deliveries projection by payer and filters', async () => {
        const h = makeTransport({
            response: {
                status: 200,
                data: {
                    serverTime: 0,
                    version: 0,
                    deliveries: [delivery({ deliveryId: '1', delivered: true }), delivery({ deliveryId: '2' })],
                },
            },
        });

        const result = await h.service.listMine(DeliveryFilter.ReadyToFinalize);

        expect(h.api.calls[0]?.path.startsWith(`/api/v1/deliveries?payer=${WALLET_ADDRESS}`)).toBe(true);
        expect(h.api.calls[0]?.authenticated).toBe(false);
        expect(result).toHaveLength(1);
        expect(result[0]?.deliveryId).toBe('2');
        expect(result[0]?.readyToFinalize).toBe(true);
    });

    it('getStatus finds a delivery by id', async () => {
        const h = makeTransport({
            response: {
                status: 200,
                data: { serverTime: 0, version: 0, deliveries: [delivery({ deliveryId: '55' })] },
            },
        });

        const result = await h.service.getStatus('55');

        expect(h.api.calls[0]?.path).toBe('/api/v1/deliveries');
        expect(result.deliveryId).toBe('55');
    });

    it('getStatus throws when the delivery is absent', async () => {
        const h = makeTransport({ response: { status: 200, data: { serverTime: 0, version: 0, deliveries: [] } } });
        await expect(h.service.getStatus('55')).rejects.toThrow(/No delivery 55/);
    });
});
