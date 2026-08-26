import { encodeFunctionData, type Address, type Hash, type Hex } from 'viem';
import { vi } from 'vitest';

import type { RequestOptions } from '../../../../api/client.js';
import type { ApiResponse } from '../../../../api/types.js';
import { LAUNCH_CHAIN_ID } from '../../../../config/constants.js';
import { ERC20_ABI } from '../../../../contracts/erc20.abi.js';
import { SEAPORT_ADDRESS } from '../../../../contracts/seaport.constants.js';
import { NoopLogger } from '../../../../logger/noop.logger.js';
import { MarketApiClient } from '../../../../services/market/client.js';
import { MarketOfferService } from '../../../../services/market/offer.service.js';
import { MarketProfileClient } from '../../../../services/market/profile.client.js';
import { MarketRecoveryStore } from '../../../../services/market/recovery.store.js';
import { MarketSingleFlight } from '../../../../services/market/single-flight.js';
import { MarketOfferKind, MarketTransactionKind, type IMarketTransport } from '../../../../services/market/types.js';
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
import type { ToolResult } from '../../__tests__/fixtures.js';
import { createMakeCellOfferTool } from '../make-offer.js';

export const BUYER = `0x${'1'.repeat(40)}`;

export const CURRENCY_ADDRESS = `0x${'3'.repeat(40)}`;

export const FEE_RECIPIENT = `0x${'4'.repeat(40)}`;

export const COLLECTION = `0x${'5'.repeat(40)}`;

export const CONDUIT = `0x${'7'.repeat(40)}`;

export const CONDUIT_KEY = `0x${'7'.repeat(64)}`;

export const CONDUIT_REGISTRY = `0x${'6'.repeat(40)}`;

export const NATIVE_ADDRESS = `0x${'0'.repeat(40)}`;

export const CURRENCY = { address: CURRENCY_ADDRESS, symbol: 'WETH', decimals: 18 };

export const OTHER_CURRENCY = { address: `0x${'8'.repeat(40)}`, symbol: 'USDC', decimals: 6 };

export const NATIVE_CURRENCY = { address: NATIVE_ADDRESS, symbol: 'ETH', decimals: 18 };

export const TOKEN_ID = '1234';

export const AMOUNT = '1000000000000000000';

export const FEE = '25000000000000000';

export const COUNTER = '7';

export const PREPARE_ID = 'b'.repeat(64);

export const ORDER_HASH = `0x${'f'.repeat(64)}`;

export const SIGNATURE = `0x${'cd'.repeat(65)}`;

export const NOW_SECONDS = 1_800_000_000;

export const EXPIRES_AT = NOW_SECONDS + 86_400;

export const INTENT_DEADLINE = NOW_SECONDS + 900;

export const PREPARE_PATH = '/api/v1/market/offers/prepare';

export const SUBMIT_PATH = '/api/v1/market/offers/submit';

export const MY_OFFERS_PATH = '/api/v1/market/me/offers';

export function approvalData(amount: string = AMOUNT, spender: string = CONDUIT): Hex {
    return encodeFunctionData({
        abi: ERC20_ABI,
        functionName: 'approve',
        args: [spender as Address, BigInt(amount)],
    });
}

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
        offerer: BUYER,
        zone: `0x${'0'.repeat(40)}`,
        offer: [
            {
                itemType: 1,
                token: CURRENCY_ADDRESS,
                identifierOrCriteria: '0',
                startAmount: AMOUNT,
                endAmount: AMOUNT,
            },
        ],
        consideration: [
            {
                itemType: 2,
                token: COLLECTION,
                identifierOrCriteria: TOKEN_ID,
                startAmount: '1',
                endAmount: '1',
                recipient: BUYER,
            },
            {
                itemType: 1,
                token: CURRENCY_ADDRESS,
                identifierOrCriteria: '0',
                startAmount: FEE,
                endAmount: FEE,
                recipient: FEE_RECIPIENT,
            },
        ],
        orderType: 0,
        startTime: NOW_SECONDS.toString(),
        endTime: EXPIRES_AT.toString(),
        zoneHash: `0x${'0'.repeat(64)}`,
        salt: '123456789',
        conduitKey: CONDUIT_KEY,
        counter: COUNTER,
        totalOriginalConsiderationItems: 2,
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

export function preparedOfferTermsWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        maker: BUYER,
        kind: MarketOfferKind.Item,
        tokenId: TOKEN_ID,
        amount: AMOUNT,
        currency: CURRENCY,
        counter: COUNTER,
        startTime: NOW_SECONDS,
        expirationTime: EXPIRES_AT,
        ...over,
    };
}

export function preparedWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        prepareId: PREPARE_ID,
        expiresAt: INTENT_DEADLINE,
        chainId: LAUNCH_CHAIN_ID,
        protocolAddress: SEAPORT_ADDRESS,
        offer: preparedOfferTermsWire(),
        transactions: [],
        order: seaportOrderWire(),
        ...over,
    };
}

export function publishedOfferWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        orderHash: ORDER_HASH,
        protocolAddress: SEAPORT_ADDRESS,
        chainId: LAUNCH_CHAIN_ID,
        maker: BUYER,
        kind: MarketOfferKind.Item,
        tokenId: TOKEN_ID,
        amount: AMOUNT,
        currency: CURRENCY,
        startTime: NOW_SECONDS,
        expirationTime: EXPIRES_AT,
        ...over,
    };
}

export function submittedWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return { offer: publishedOfferWire(over) };
}

export function offersPageWire(items: Array<unknown>, nextCursor: string | null): Record<string, unknown> {
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
    MyOffers = 'my-offers',
}

function routeOf(path: string): MarketRoute {
    if (path.startsWith(PREPARE_PATH)) {
        return MarketRoute.Prepare;
    }
    if (path.startsWith(SUBMIT_PATH)) {
        return MarketRoute.Submit;
    }
    return MarketRoute.MyOffers;
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

export class FakeAppConfig implements IAppConfig {
    private readonly cell: string;

    constructor(cell: string = COLLECTION) {
        this.cell = cell;
    }

    async load(): Promise<AppConfig> {
        return { contracts: { cell: this.cell } } as AppConfig;
    }
}

export interface FakeWalletOptions {
    chainId: number;
    receiptStatus: TxStatus;
    clockJumpMs: number;
    counter: bigint | null;
    conduit: string | null;
    protocolReadFails: boolean;
}

export class FakeBuyerWallet implements WalletManager, WalletProvider {
    async getTransactionSender(): Promise<Address | null> {
        return this.getAddress();
    }
    readonly log: Array<string> = [];
    readonly signed: Array<SignTypedDataRequest> = [];
    readonly reads: Array<ReadContractParams> = [];
    readonly broadcast: Array<TransactionRequest> = [];
    private readonly options: FakeWalletOptions;
    private sent = 0;

    constructor(over: Partial<FakeWalletOptions> = {}) {
        this.options = {
            chainId: LAUNCH_CHAIN_ID,
            receiptStatus: TxStatus.Success,
            clockJumpMs: 0,
            counter: BigInt(COUNTER),
            conduit: CONDUIT,
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

    async sendTransaction(tx: TransactionRequest): Promise<Hash> {
        this.sent += 1;
        this.broadcast.push(tx);
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
        return SIGNATURE as Hex;
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

    async readContract(params: ReadContractParams): Promise<unknown> {
        this.log.push(`read:${params.functionName}`);
        this.reads.push(params);

        if (params.functionName === 'information') {
            if (this.options.protocolReadFails) {
                throw new Error('the node refused the call');
            }
            return ['1.6', `0x${'0'.repeat(64)}`, CONDUIT_REGISTRY];
        }
        if (params.functionName === 'getConduit') {
            const conduit = this.options.conduit;
            return conduit === null ? [`0x${'0'.repeat(40)}`, false] : [conduit, true];
        }

        if (this.options.counter === null) {
            throw new Error('the node refused the call');
        }
        return this.options.counter;
    }
}

export interface MakeOfferHarness {
    handler: (args: never) => Promise<ToolResult>;
    transport: RoutedMarketTransport;
    wallet: FakeBuyerWallet;
    recovery: MarketRecoveryStore;
    service: MarketOfferService;
    description: string;
    inputSchema: Record<string, unknown>;
}

export function makeOfferHarness(
    transport: RoutedMarketTransport,
    wallet: FakeBuyerWallet = new FakeBuyerWallet(),
    recovery: MarketRecoveryStore = new MarketRecoveryStore(),
    appConfig: IAppConfig = new FakeAppConfig(),
): MakeOfferHarness {
    const logger = new NoopLogger();
    const client = new MarketApiClient({ api: transport, logger });
    const service = new MarketOfferService({
        client,
        profile: new MarketProfileClient({ client, logger }),
        appConfig,
        wallet,
        network: 'robinhood',
        singleFlight: new MarketSingleFlight(),
        recovery,
        logger,
    });

    const definition = createMakeCellOfferTool({ marketOffer: service });
    return {
        handler: definition.handler as (args: never) => Promise<ToolResult>,
        transport,
        wallet,
        recovery,
        service,
        description: definition.description,
        inputSchema: definition.inputSchema as Record<string, unknown>,
    };
}

export function makeOfferArgs(over: Record<string, unknown> = {}): never {
    return { tokenId: TOKEN_ID, amount: AMOUNT, expirationTime: EXPIRES_AT, ...over } as never;
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
