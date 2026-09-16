import {
    encodeAbiParameters,
    encodeEventTopics,
    encodeFunctionData,
    zeroAddress,
    type Address,
    type Hash,
    type Hex,
    type Log,
} from 'viem';

import type { RequestOptions } from '../../../../api/client.js';
import type { ApiResponse } from '../../../../api/types.js';
import { LAUNCH_CHAIN_ID } from '../../../../config/constants.js';
import { ERC20_ABI } from '../../../../contracts/erc20.abi.js';
import { SEAPORT_EVENTS_ABI } from '../../../../contracts/seaport-events.abi.js';
import { SEAPORT_ADDRESS } from '../../../../contracts/seaport.constants.js';
import { NoopLogger } from '../../../../logger/noop.logger.js';
import type { IMarketRecoveryStore, IMarketSingleFlight } from '../../../../services/market/action.types.js';
import { MarketApiClient } from '../../../../services/market/client.js';
import { MarketFulfilmentProof } from '../../../../services/market/fulfilment-proof.js';
import type { IFulfilmentTransactionReader } from '../../../../services/market/fulfilment-proof.types.js';
import { MarketPurchaseService } from '../../../../services/market/purchase.service.js';
import { MarketRecoveryStore } from '../../../../services/market/recovery.store.js';
import { MarketSingleFlight } from '../../../../services/market/single-flight.js';
import { MarketTransactionKind, type IMarketTransport } from '../../../../services/market/types.js';
import type { AppConfig, IAppConfig } from '../../../../services/types.js';
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
import { captureMarketTool, type CapturedTool, type ToolResult } from '../../__tests__/fixtures.js';
import { createBuyCellTool } from '../buy-cell.js';

export const BUYER = `0x${'1'.repeat(40)}`;

export const SELLER = `0x${'2'.repeat(40)}`;

export const STRANGER = `0x${'3'.repeat(40)}`;

export const CURRENCY_ADDRESS = `0x${'4'.repeat(40)}`;

export const COLLECTION = `0x${'5'.repeat(40)}`;

export const OTHER_CONTRACT = `0x${'6'.repeat(40)}`;

export const CONDUIT = `0x${'7'.repeat(40)}`;

export const CONDUIT_KEY = `0x${'7'.repeat(64)}`;

export const CONDUIT_REGISTRY = `0x${'8'.repeat(40)}`;

export const ZONE = zeroAddress;

export const NATIVE_CURRENCY = { address: zeroAddress, symbol: 'ETH', decimals: 18 };

export const ERC20_CURRENCY = { address: CURRENCY_ADDRESS, symbol: 'WETH', decimals: 18 };

export const TOKEN_ID = '1234';

export const OTHER_TOKEN_ID = '4321';

export const PRICE = '1000000000000000000';

export const MAX_AMOUNT = '1200000000000000000';

export const ORDER_HASH = `0x${'e'.repeat(64)}`;

export const OTHER_ORDER_HASH = `0x${'d'.repeat(64)}`;

export const NOW_SECONDS = 1_800_000_000;

export const EXPIRES_AT = NOW_SECONDS + 86_400;

export const PREPARE_PATH = '/api/v1/market/purchases/prepare';

export const FULFILMENT_CALLDATA = '0xfb0f3ee1';

export const BARE_APPROVAL_SELECTOR = '0x095ea7b3';

export function approvalData(amount: string = PRICE, spender: string = CONDUIT): Hex {
    return encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender as Address, BigInt(amount)],
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

export function listingWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        orderHash: ORDER_HASH,
        protocolAddress: SEAPORT_ADDRESS,
        chainId: LAUNCH_CHAIN_ID,
        maker: SELLER,
        tokenId: TOKEN_ID,
        price: PRICE,
        currency: NATIVE_CURRENCY,
        startTime: NOW_SECONDS - 60,
        expirationTime: EXPIRES_AT,
        ...over,
    };
}

export function fulfilmentWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        kind: MarketTransactionKind.Fulfillment,
        to: SEAPORT_ADDRESS,
        data: FULFILMENT_CALLDATA,
        value: PRICE,
        chainId: LAUNCH_CHAIN_ID,
        ...over,
    };
}

export function approvalWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        kind: MarketTransactionKind.CurrencyApproval,
        to: CURRENCY_ADDRESS,
        data: approvalData(),
        value: '0',
        chainId: LAUNCH_CHAIN_ID,
        ...over,
    };
}

export function preparedWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    const listing = (over.listing ?? listingWire()) as ReturnType<typeof listingWire>;
    const currency = listing.currency as typeof NATIVE_CURRENCY;
    const transactions = (over.transactions ?? [fulfilmentWire()]) as Array<Record<string, unknown>>;

    return {
        listing: {
            orderHash: listing.orderHash,
            protocolAddress: listing.protocolAddress,
            maker: listing.maker,
            tokenId: listing.tokenId,
            price: {
                currencyAddress: currency.address,
                symbol: currency.symbol,
                decimals: currency.decimals,
                amountBaseUnits: listing.price,
            },
            startsAt: listing.startTime,
            expiresAt: listing.expirationTime,
        },
        transactions: transactions.map((transaction) => ({
            ...transaction,
            kind: transaction.kind,
        })),
    };
}

export function erc20PreparedWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return preparedWire({
        listing: listingWire({ currency: ERC20_CURRENCY }),
        transactions: [approvalWire(), fulfilmentWire({ value: '0' })],
        ...over,
    });
}

const FULFILLED_DATA_PARAMS = [
    { name: 'orderHash', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    {
        name: 'offer',
        type: 'tuple[]',
        components: [
            { name: 'itemType', type: 'uint8' },
            { name: 'token', type: 'address' },
            { name: 'identifier', type: 'uint256' },
            { name: 'amount', type: 'uint256' },
        ],
    },
    {
        name: 'consideration',
        type: 'tuple[]',
        components: [
            { name: 'itemType', type: 'uint8' },
            { name: 'token', type: 'address' },
            { name: 'identifier', type: 'uint256' },
            { name: 'amount', type: 'uint256' },
            { name: 'recipient', type: 'address' },
        ],
    },
] as const;

export interface FulfilledLogOver {
    emitter: string;
    orderHash: string;
    recipient: string;
    offerer: string;
    cell: string | null;
}

export function orderFulfilledLog(over: Partial<FulfilledLogOver> = {}): Log {
    const shape: FulfilledLogOver = {
        emitter: SEAPORT_ADDRESS,
        orderHash: ORDER_HASH,
        recipient: BUYER,
        offerer: SELLER,
        cell: TOKEN_ID,
        ...over,
    };
    const moved =
        shape.cell === null
            ? []
            : [{ itemType: 2, token: COLLECTION as Address, identifier: BigInt(shape.cell), amount: 1n }];

    return {
        address: shape.emitter,
        topics: encodeEventTopics({
            abi: SEAPORT_EVENTS_ABI,
            eventName: 'OrderFulfilled',
            args: { offerer: shape.offerer as Address, zone: ZONE },
        }),
        data: encodeAbiParameters(FULFILLED_DATA_PARAMS, [
            shape.orderHash as Hex,
            shape.recipient as Address,
            moved,
            [],
        ]),
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

export class FakeAppConfig implements IAppConfig {
    constructor(private readonly land: string = COLLECTION) {}

    async load(): Promise<AppConfig> {
        return { contracts: { land: this.land } } as AppConfig;
    }
}

export class FakeTransactionReader implements IFulfilmentTransactionReader {
    readonly asked: Array<string> = [];

    constructor(private readonly sender: string | null = BUYER) {}

    async senderOf(hash: string): Promise<string | null> {
        this.asked.push(hash);
        return this.sender;
    }
}

export interface FakeBuyerWalletOptions {
    chainId: number;
    owner: string;
    logs: Array<Log>;
    sendFailsAt: number | null;
    receiptFailsAt: number | null;
    revertsAt: number | null;
    readFails: boolean;
    conduitKnown: boolean;
    protocolReadFails: boolean;
}

export class FakeBuyerWallet implements WalletManager, WalletProvider {
    async getTransactionSender(): Promise<Address | null> {
        return this.getAddress();
    }
    readonly log: Array<string> = [];
    readonly sent: Array<TransactionRequest> = [];
    readonly reads: Array<ReadContractParams> = [];
    private readonly options: FakeBuyerWalletOptions;
    private sends = 0;
    private receipts = 0;

    constructor(over: Partial<FakeBuyerWalletOptions> = {}) {
        this.options = {
            chainId: LAUNCH_CHAIN_ID,
            owner: BUYER,
            logs: [orderFulfilledLog()],
            sendFailsAt: null,
            receiptFailsAt: null,
            revertsAt: null,
            readFails: false,
            conduitKnown: true,
            protocolReadFails: false,
            ...over,
        };
    }

    get(): WalletManager {
        return this;
    }

    isReady(): boolean {
        return true;
    }

    getAddress(): Address {
        return BUYER as Address;
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

        if (params.functionName === 'information') {
            if (this.options.protocolReadFails) {
                throw new Error('the protocol contract could not be read');
            }
            return ['1.6', `0x${'0'.repeat(64)}`, CONDUIT_REGISTRY];
        }
        if (params.functionName === 'getKey') {
            const known = this.options.conduitKnown && params.args[0] === CONDUIT;
            if (!known) {
                throw new Error('NoConduit');
            }
            return CONDUIT_KEY;
        }

        if (this.options.readFails) {
            throw new Error('the collection contract could not be read');
        }
        if (params.functionName === 'ownerOf') {
            return this.options.owner;
        }
        return { owner: this.options.owner };
    }

    async signTypedData(_request: SignTypedDataRequest): Promise<Hex> {
        throw new Error('buying a listing signs nothing');
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

export interface BuyCellHarnessOver {
    wallet: FakeBuyerWallet;
    reader: FakeTransactionReader;
    recovery: IMarketRecoveryStore;
    singleFlight: IMarketSingleFlight;
    appConfig: IAppConfig;
}

export interface BuyCellHarness {
    tool: CapturedTool;
    handler: (args: never) => Promise<ToolResult>;
    transport: FakeMarketTransport;
    wallet: FakeBuyerWallet;
    reader: FakeTransactionReader;
    recovery: IMarketRecoveryStore;
    service: MarketPurchaseService;
}

export function buyCellHarness(
    transport: FakeMarketTransport = transportOf(),
    over: Partial<BuyCellHarnessOver> = {},
): BuyCellHarness {
    const logger = new NoopLogger();
    const wallet = over.wallet ?? new FakeBuyerWallet();
    const reader = over.reader ?? new FakeTransactionReader();
    const recovery = over.recovery ?? new MarketRecoveryStore();
    const service = new MarketPurchaseService({
        client: new MarketApiClient({ api: transport, logger }),
        proof: new MarketFulfilmentProof({ transactions: reader, logger }),
        appConfig: over.appConfig ?? new FakeAppConfig(),
        wallet,
        network: 'robinhood',
        singleFlight: over.singleFlight ?? new MarketSingleFlight(),
        recovery,
        logger,
    });

    const tool = captureMarketTool(createBuyCellTool, { marketPurchase: service });
    return { tool, handler: tool.handler, transport, wallet, reader, recovery, service };
}

export function buyCellArgs(over: Record<string, unknown> = {}): never {
    return { tokenId: TOKEN_ID, expectedOrderHash: ORDER_HASH, maxAmount: MAX_AMOUNT, ...over } as never;
}

export function parsed(result: ToolResult): Record<string, unknown> {
    return JSON.parse(result.content[1]?.text ?? '{}') as Record<string, unknown>;
}

export function summary(result: ToolResult): string {
    return result.content[0]?.text ?? '';
}
