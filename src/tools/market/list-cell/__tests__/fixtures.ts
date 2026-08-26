import type { Address, Hash, Hex } from 'viem';
import { vi } from 'vitest';

import type { RequestOptions } from '../../../../api/client.js';
import type { ApiResponse } from '../../../../api/types.js';
import { LAUNCH_CHAIN_ID } from '../../../../config/constants.js';
import { SEAPORT_ADDRESS } from '../../../../contracts/seaport.constants.js';
import { NoopLogger } from '../../../../logger/noop.logger.js';
import { MarketApiClient } from '../../../../services/market/client.js';
import { MarketListingService } from '../../../../services/market/listing.service.js';
import { MarketProfileClient } from '../../../../services/market/profile.client.js';
import { MarketRecoveryStore } from '../../../../services/market/recovery.store.js';
import { MarketSingleFlight } from '../../../../services/market/single-flight.js';
import { MarketTransactionKind, type IMarketTransport } from '../../../../services/market/types.js';
import {
    TxStatus,
    type GasEstimateRequest,
    type ReadContractParams,
    type TransactionRequest,
    type TxReceipt,
    type SignTypedDataRequest,
    type WalletManager,
    type WalletProvider,
} from '../../../../wallet/types.js';
import { captureMarketTool, type ToolResult } from '../../__tests__/fixtures.js';
import { createListCellTool } from '../list-cell.js';

export const SELLER = `0x${'1'.repeat(40)}`;

export const RESERVED_BUYER = `0x${'2'.repeat(40)}`;

export const CURRENCY_ADDRESS = `0x${'3'.repeat(40)}`;

export const FEE_RECIPIENT = `0x${'4'.repeat(40)}`;

export const COLLECTION = `0x${'5'.repeat(40)}`;

export const TOKEN_ID = '1234';

export const PRICE = '1000000000000000000';

export const PLATFORM_FEE = '25000000000000000';

export const CREATOR_FEE = '50000000000000000';

export const PROCEEDS = '925000000000000000';

export const PREPARE_ID = 'a'.repeat(64);

export const ORDER_HASH = `0x${'e'.repeat(64)}`;

export const NOW_SECONDS = 1_800_000_000;

export const EXPIRES_AT = NOW_SECONDS + 86_400;

export const INTENT_DEADLINE = NOW_SECONDS + 900;

export const CURRENCY = { address: CURRENCY_ADDRESS, symbol: 'WETH', decimals: 18 };

export const PREPARE_PATH = '/api/v1/market/listings/prepare';

export const SUBMIT_PATH = '/api/v1/market/listings/submit';

export const MY_LISTINGS_PATH = '/api/v1/market/me/listings';

export interface FakeReply {
    status: number;
    data: unknown;
    headers: Record<string, string>;
}

export function reply(status: number, data: unknown, headers: Record<string, string> = {}): FakeReply {
    return { status, data, headers };
}

export function seaportOrderWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        offerer: SELLER,
        zone: `0x${'0'.repeat(40)}`,
        offer: [
            {
                itemType: 2,
                token: COLLECTION,
                identifierOrCriteria: TOKEN_ID,
                startAmount: '1',
                endAmount: '1',
            },
        ],
        consideration: [
            {
                itemType: 1,
                token: CURRENCY_ADDRESS,
                identifierOrCriteria: '0',
                startAmount: PROCEEDS,
                endAmount: PROCEEDS,
                recipient: SELLER,
            },
            {
                itemType: 1,
                token: CURRENCY_ADDRESS,
                identifierOrCriteria: '0',
                startAmount: PLATFORM_FEE,
                endAmount: PLATFORM_FEE,
                recipient: FEE_RECIPIENT,
            },
            {
                itemType: 1,
                token: CURRENCY_ADDRESS,
                identifierOrCriteria: '0',
                startAmount: CREATOR_FEE,
                endAmount: CREATOR_FEE,
                recipient: FEE_RECIPIENT,
            },
        ],
        orderType: 0,
        startTime: NOW_SECONDS.toString(),
        endTime: EXPIRES_AT.toString(),
        zoneHash: `0x${'0'.repeat(64)}`,
        salt: '987654321',
        conduitKey: `0x${'0'.repeat(64)}`,
        counter: '0',
        totalOriginalConsiderationItems: 3,
        ...over,
    };
}

export function approvalWire(to: string): Record<string, unknown> {
    return {
        kind: MarketTransactionKind.CollectionApproval,
        to,
        data: '0xa22cb465',
        value: '0',
        chainId: LAUNCH_CHAIN_ID,
    };
}

export function preparedWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        prepareId: PREPARE_ID,
        expiresAt: INTENT_DEADLINE,
        chainId: LAUNCH_CHAIN_ID,
        protocolAddress: SEAPORT_ADDRESS,
        listing: {
            maker: SELLER,
            tokenId: TOKEN_ID,
            price: PRICE,
            currency: CURRENCY,
            startTime: NOW_SECONDS,
            expirationTime: EXPIRES_AT,
            buyerAddress: null,
        },
        fees: { platformFee: PLATFORM_FEE, creatorFee: CREATOR_FEE, estimatedProceeds: PROCEEDS },
        transactions: [],
        order: seaportOrderWire(),
        ...over,
    };
}

export function publishedListingWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        orderHash: ORDER_HASH,
        protocolAddress: SEAPORT_ADDRESS,
        chainId: LAUNCH_CHAIN_ID,
        maker: SELLER,
        tokenId: TOKEN_ID,
        price: PRICE,
        currency: CURRENCY,
        startTime: NOW_SECONDS,
        expirationTime: EXPIRES_AT,
        ...over,
    };
}

export function submittedWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return { listing: publishedListingWire(over) };
}

export function listingsPageWire(items: Array<unknown>, nextCursor: string | null): Record<string, unknown> {
    return { items, nextCursor };
}

export interface RecordedCall {
    path: string;
    method: string;
    body: unknown;
}

export enum MarketRoute {
    Prepare = 'prepare',
    Submit = 'submit',
    MyListings = 'my-listings',
}

function routeOf(path: string): MarketRoute {
    if (path.startsWith(PREPARE_PATH)) {
        return MarketRoute.Prepare;
    }
    if (path.startsWith(SUBMIT_PATH)) {
        return MarketRoute.Submit;
    }
    return MarketRoute.MyListings;
}

export class RoutedMarketTransport implements IMarketTransport {
    readonly calls: Array<RecordedCall> = [];
    private readonly queues: Map<MarketRoute, Array<FakeReply | Error>>;

    constructor(routes: Partial<Record<MarketRoute, Array<FakeReply | Error>>>) {
        this.queues = new Map(
            Object.entries(routes).map(([route, replies]) => [route as MarketRoute, [...(replies ?? [])]]),
        );
    }

    callsOn(route: MarketRoute): Array<RecordedCall> {
        return this.calls.filter((call) => routeOf(call.path) === route);
    }

    async authenticatedRequest<T>(path: string, options: RequestOptions | null): Promise<ApiResponse<T>> {
        this.calls.push({ path, method: options?.method ?? 'GET', body: options?.body ?? null });

        const route = routeOf(path);
        const queue = this.queues.get(route) ?? [];
        const next = queue.length > 1 ? queue.shift() : queue[0];
        if (next === undefined) {
            throw new Error(`no reply configured for ${path}`);
        }
        if (next instanceof Error) {
            throw next;
        }

        return { status: next.status, headers: new Headers(next.headers), data: next.data as T };
    }
}

export interface FakeWalletOptions {
    chainId: number;
    receiptStatus: TxStatus;
    clockJumpMs: number;
}

export class FakeSellerWallet implements WalletManager, WalletProvider {
    readonly log: Array<string> = [];
    readonly signed: Array<SignTypedDataRequest> = [];
    private readonly options: FakeWalletOptions;
    private sent = 0;

    constructor(over: Partial<FakeWalletOptions> = {}) {
        this.options = { chainId: LAUNCH_CHAIN_ID, receiptStatus: TxStatus.Success, clockJumpMs: 0, ...over };
    }

    get(): WalletManager {
        return this;
    }

    isReady(): boolean {
        return true;
    }

    getAddress(): Address {
        return SELLER as Address;
    }

    getChainId(): number {
        return this.options.chainId;
    }

    async sendTransaction(tx: TransactionRequest): Promise<Hash> {
        this.sent += 1;
        this.log.push(`send:${tx.to}`);
        return `0x${this.sent.toString().repeat(64)}`.slice(0, 66) as Hash;
    }

    async waitForReceipt(hash: Hash): Promise<TxReceipt> {
        this.log.push(`receipt:${hash}`);
        if (this.options.clockJumpMs > 0) {
            vi.setSystemTime(Date.now() + this.options.clockJumpMs);
        }
        return { status: this.options.receiptStatus, transactionHash: hash, blockNumber: 1n, logs: [] };
    }

    async signTypedData(request: SignTypedDataRequest): Promise<Hex> {
        this.log.push('sign');
        this.signed.push(request);
        return `0x${'ab'.repeat(65)}`;
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

    async readContract(_params: ReadContractParams): Promise<unknown> {
        throw new Error('no contract read is part of publishing a listing');
    }
}

export interface ListCellHarness {
    handler: (args: never) => Promise<ToolResult>;
    transport: RoutedMarketTransport;
    wallet: FakeSellerWallet;
    recovery: MarketRecoveryStore;
    service: MarketListingService;
}

export function listCellHarness(
    transport: RoutedMarketTransport,
    wallet: FakeSellerWallet = new FakeSellerWallet(),
    recovery: MarketRecoveryStore = new MarketRecoveryStore(),
): ListCellHarness {
    const logger = new NoopLogger();
    const client = new MarketApiClient({ api: transport, logger });
    const service = new MarketListingService({
        client,
        profile: new MarketProfileClient({ client, logger }),
        wallet,
        network: 'robinhood',
        singleFlight: new MarketSingleFlight(),
        recovery,
        logger,
    });

    const captured = captureMarketTool(createListCellTool, { marketListing: service });
    return { handler: captured.handler, transport, wallet, recovery, service };
}

export function listCellArgs(over: Record<string, unknown> = {}): never {
    return { tokenId: TOKEN_ID, price: PRICE, expirationTime: EXPIRES_AT, buyerAddress: null, ...over } as never;
}

export async function settle<T>(promise: Promise<T>): Promise<unknown> {
    const outcome = promise.then(
        (value) => ({ value }),
        (error: unknown) => ({ value: error }),
    );
    let done = false;
    void outcome.then(() => {
        done = true;
    });
    for (let step = 0; step < 600 && !done; step += 1) {
        await vi.advanceTimersToNextTimerAsync();
    }
    return (await outcome).value;
}

export function parsed(result: ToolResult): Record<string, unknown> {
    return JSON.parse(result.content[1]?.text ?? '{}') as Record<string, unknown>;
}
