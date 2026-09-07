import {
    encodeAbiParameters,
    encodeEventTopics,
    encodeFunctionData,
    zeroAddress,
    type Abi,
    type Address,
    type Hash,
    type Hex,
    type Log,
} from 'viem';

import type { RequestOptions } from '../../../../api/client.js';
import type { ApiResponse } from '../../../../api/types.js';
import { LAUNCH_CHAIN_ID } from '../../../../config/constants.js';
import { SEAPORT_EVENTS_ABI } from '../../../../contracts/seaport-events.abi.js';
import { SEAPORT_ADDRESS } from '../../../../contracts/seaport.constants.js';
import { NoopLogger } from '../../../../logger/noop.logger.js';
import type { IMarketRecoveryStore, IMarketSingleFlight } from '../../../../services/market/action.types.js';
import { SEAPORT_CANCEL_ABI } from '../../../../services/market/cancel.abi.js';
import { MarketCancelService } from '../../../../services/market/cancel.service.js';
import { seaportOrderHash } from '../../../../services/market/cancel.utils.js';
import { MarketApiClient } from '../../../../services/market/client.js';
import { MarketFulfilmentProof } from '../../../../services/market/fulfilment-proof.js';
import type { IFulfilmentTransactionReader } from '../../../../services/market/fulfilment-proof.types.js';
import { MarketRecoveryStore } from '../../../../services/market/recovery.store.js';
import { MarketSingleFlight } from '../../../../services/market/single-flight.js';
import { MarketTransactionKind, type IMarketTransport } from '../../../../services/market/types.js';
import {
    TxStatus,
    type GasEstimateRequest,
    type ReadContractParams,
    type SignTypedDataRequest,
    type TransactionRequest,
    type TxReceipt,
    type WalletManager,
    type WalletProvider,
} from '../../../../wallet/types.js';
import type { ToolResult } from '../../__tests__/fixtures.js';
import { createCancelOrderTool } from '../cancel-order.js';

export const MAKER = `0x${'1'.repeat(40)}`;

export const STRANGER = `0x${'3'.repeat(40)}`;

export const OTHER_CONTRACT = `0x${'6'.repeat(40)}`;

export const COLLECTION = `0x${'5'.repeat(40)}`;

export const CURRENCY_ADDRESS = `0x${'4'.repeat(40)}`;

export const ZONE = zeroAddress;

export const CONDUIT_KEY = `0x${'7'.repeat(64)}`;

export const TOKEN_ID = '1234';

export const PRICE = '1000000000000000000';

export const NOW_SECONDS = 1_800_000_000;

export const PREPARE_PATH = '/api/v1/market/orders/cancel/prepare';

export interface OrderComponentsOver {
    offerer: string;
    salt: bigint;
    counter: bigint;
}

export function orderComponents(over: Partial<OrderComponentsOver> = {}): Record<string, unknown> {
    const shape: OrderComponentsOver = { offerer: MAKER, salt: 9n, counter: 0n, ...over };

    return {
        offerer: shape.offerer,
        zone: ZONE,
        offer: [
            {
                itemType: 2,
                token: COLLECTION,
                identifierOrCriteria: BigInt(TOKEN_ID),
                startAmount: 1n,
                endAmount: 1n,
            },
        ],
        consideration: [
            {
                itemType: 1,
                token: CURRENCY_ADDRESS,
                identifierOrCriteria: 0n,
                startAmount: BigInt(PRICE),
                endAmount: BigInt(PRICE),
                recipient: shape.offerer,
            },
        ],
        orderType: 0,
        startTime: BigInt(NOW_SECONDS - 60),
        endTime: BigInt(NOW_SECONDS + 86_400),
        zoneHash: `0x${'0'.repeat(64)}`,
        salt: shape.salt,
        conduitKey: CONDUIT_KEY,
        counter: shape.counter,
    };
}

export function orderHashOf(components: Record<string, unknown>): string {
    return seaportOrderHash(components);
}

export const ORDER_HASH = orderHashOf(orderComponents());

export const OTHER_ORDER_HASH = orderHashOf(orderComponents({ salt: 77n }));

export function offerOrderComponents(): Record<string, unknown> {
    const listing = orderComponents();
    const [cell] = listing.offer as Array<Record<string, unknown>>;
    const payment = (listing.consideration as Array<Record<string, unknown>>)[0] as Record<string, unknown>;
    const { recipient: _recipient, ...paymentItem } = payment;

    return {
        ...listing,
        offer: [paymentItem],
        consideration: [{ ...cell, recipient: MAKER }],
    };
}

export const OFFER_ORDER_HASH = orderHashOf(offerOrderComponents());

export function cancelData(orders: Array<Record<string, unknown>> = [orderComponents()]): Hex {
    return encodeFunctionData({
        abi: SEAPORT_CANCEL_ABI as unknown as Abi,
        functionName: 'cancel',
        args: [orders],
    });
}

export function txHash(index: number): string {
    return `0x${index.toString().repeat(64)}`.slice(0, 66);
}

export interface FakeReply {
    status: number;
    data: unknown;
    headers: Record<string, string>;
}

export function reply(status: number, data: unknown, headers: Record<string, string> = {}): FakeReply {
    return { status, data, headers };
}

export function cancellationWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        kind: MarketTransactionKind.Cancellation,
        to: SEAPORT_ADDRESS,
        data: cancelData(),
        value: '0',
        chainId: LAUNCH_CHAIN_ID,
        ...over,
    };
}

export function preparedWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        orderHash: ORDER_HASH,
        protocolAddress: SEAPORT_ADDRESS,
        transaction: cancellationWire(),
        ...over,
    };
}

export function offerPreparedWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        orderHash: OFFER_ORDER_HASH,
        protocolAddress: SEAPORT_ADDRESS,
        transaction: cancellationWire({ data: cancelData([offerOrderComponents()]) }),
        ...over,
    };
}

export interface CancelledLogOver {
    emitter: string;
    orderHash: string;
    offerer: string;
}

export function orderCancelledLog(over: Partial<CancelledLogOver> = {}): Log {
    const shape: CancelledLogOver = { emitter: SEAPORT_ADDRESS, orderHash: ORDER_HASH, offerer: MAKER, ...over };

    return {
        address: shape.emitter,
        topics: encodeEventTopics({
            abi: SEAPORT_EVENTS_ABI,
            eventName: 'OrderCancelled',
            args: { offerer: shape.offerer as Address, zone: ZONE },
        }),
        data: encodeAbiParameters([{ name: 'orderHash', type: 'bytes32' }], [shape.orderHash as Hex]),
    } as unknown as Log;
}

export interface RecordedCall {
    path: string;
    method: string;
    body: unknown;
}

export class FakeMarketTransport implements IMarketTransport {
    readonly calls: Array<RecordedCall> = [];
    private readonly replies: Array<FakeReply | Error>;

    constructor(replies: Array<FakeReply | Error>) {
        this.replies = [...replies];
    }

    async authenticatedRequest<T>(path: string, options: RequestOptions | null): Promise<ApiResponse<T>> {
        this.calls.push({ path, method: options?.method ?? 'GET', body: options?.body ?? null });

        const next = this.replies.length > 1 ? this.replies.shift() : this.replies[0];
        if (next === undefined) {
            throw new Error(`no reply configured for ${path}`);
        }
        if (next instanceof Error) {
            throw next;
        }

        return { status: next.status, headers: new Headers(next.headers), data: next.data as T };
    }
}

export function transportOf(...replies: Array<FakeReply | Error>): FakeMarketTransport {
    return new FakeMarketTransport(replies.length === 0 ? [reply(200, preparedWire())] : replies);
}

export class FakeTransactionReader implements IFulfilmentTransactionReader {
    readonly asked: Array<string> = [];

    constructor(private readonly sender: string | null = MAKER) {}

    async senderOf(hash: string): Promise<string | null> {
        this.asked.push(hash);
        return this.sender;
    }
}

export interface FakeMakerWalletOptions {
    chainId: number;
    logs: Array<Log>;
    sendFailsAt: number | null;
    receiptFailsAt: number | null;
    revertsAt: number | null;
    transactionSender: string | null;
}

export class FakeMakerWallet implements WalletManager, WalletProvider {
    readonly log: Array<string> = [];
    readonly sent: Array<TransactionRequest> = [];
    readonly reads: Array<ReadContractParams> = [];
    readonly senderAsks: Array<string> = [];
    private readonly options: FakeMakerWalletOptions;
    private sends = 0;
    private receipts = 0;

    constructor(over: Partial<FakeMakerWalletOptions> = {}) {
        this.options = {
            chainId: LAUNCH_CHAIN_ID,
            logs: [orderCancelledLog()],
            sendFailsAt: null,
            receiptFailsAt: null,
            revertsAt: null,
            transactionSender: MAKER,
            ...over,
        };
    }

    async getTransactionSender(hash: Hash): Promise<Address | null> {
        this.senderAsks.push(hash);
        return this.options.transactionSender as Address | null;
    }

    get(): WalletManager {
        return this;
    }

    isReady(): boolean {
        return true;
    }

    getAddress(): Address {
        return MAKER as Address;
    }

    getChainId(): number {
        return this.options.chainId;
    }

    get sendCount(): number {
        return this.sends;
    }

    async sendTransaction(tx: TransactionRequest): Promise<Hash> {
        this.sends += 1;
        if (this.options.sendFailsAt === this.sends) {
            this.log.push('send:lost');
            throw new Error('the node never answered the broadcast');
        }

        this.sent.push(tx);
        this.log.push(`send:${tx.to}:${tx.value?.toString() ?? 'null'}`);
        return txHash(this.sends) as Hash;
    }

    async waitForReceipt(hash: Hash): Promise<TxReceipt> {
        this.receipts += 1;
        this.log.push(`receipt:${hash}`);
        if (this.options.receiptFailsAt === this.receipts) {
            throw new Error('the receipt could not be read');
        }

        const reverted = this.options.revertsAt === this.receipts;
        return {
            status: reverted ? TxStatus.Reverted : TxStatus.Success,
            transactionHash: hash,
            blockNumber: 1n,
            logs: this.options.logs,
        };
    }

    async readContract(params: ReadContractParams): Promise<unknown> {
        this.reads.push(params);
        this.log.push(`read:${params.functionName}`);
        throw new Error('cancelling an order reads no contract');
    }

    async signTypedData(_request: SignTypedDataRequest): Promise<Hex> {
        throw new Error('cancelling an order signs nothing');
    }

    async signMessage(): Promise<Hex> {
        return '0x';
    }

    async estimateGas(_tx: GasEstimateRequest): Promise<bigint> {
        return 21_000n;
    }

    async getGasPrice(): Promise<bigint> {
        return 1n;
    }

    async getBalance(): Promise<bigint> {
        return 0n;
    }
}

export interface CancelOrderHarnessOver {
    wallet: FakeMakerWallet;
    reader: FakeTransactionReader;
    recovery: IMarketRecoveryStore;
    singleFlight: IMarketSingleFlight;
}

export interface CancelOrderHarness {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    handler: (args: never) => Promise<ToolResult>;
    transport: FakeMarketTransport;
    wallet: FakeMakerWallet;
    reader: FakeTransactionReader;
    recovery: IMarketRecoveryStore;
    service: MarketCancelService;
}

export function cancelOrderHarness(
    transport: FakeMarketTransport = transportOf(),
    over: Partial<CancelOrderHarnessOver> = {},
): CancelOrderHarness {
    const logger = new NoopLogger();
    const wallet = over.wallet ?? new FakeMakerWallet();
    const reader = over.reader ?? new FakeTransactionReader();
    const recovery = over.recovery ?? new MarketRecoveryStore();
    const service = new MarketCancelService({
        client: new MarketApiClient({ api: transport, logger }),
        proof: new MarketFulfilmentProof({ transactions: reader, logger }),
        wallet,
        network: 'robinhood',
        singleFlight: over.singleFlight ?? new MarketSingleFlight(),
        recovery,
        logger,
    });

    const definition = createCancelOrderTool({ marketCancel: service });
    return {
        name: definition.name,
        description: definition.description,
        inputSchema: definition.inputSchema as Record<string, unknown>,
        handler: definition.handler as (args: never) => Promise<ToolResult>,
        transport,
        wallet,
        reader,
        recovery,
        service,
    };
}

export function cancelOrderArgs(over: Record<string, unknown> = {}): never {
    return { orderHash: ORDER_HASH, ...over } as never;
}

export function parsed(result: ToolResult): Record<string, unknown> {
    return JSON.parse(result.content[1]?.text ?? '{}') as Record<string, unknown>;
}

export function summary(result: ToolResult): string {
    return result.content[0]?.text ?? '';
}
