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
import { ERC721_OPERATOR_ABI } from '../../../../contracts/erc721.abi.js';
import { SEAPORT_EVENTS_ABI } from '../../../../contracts/seaport-events.abi.js';
import { SEAPORT_ADDRESS } from '../../../../contracts/seaport.constants.js';
import { NoopLogger } from '../../../../logger/noop.logger.js';
import { MarketAcceptanceService } from '../../../../services/market/acceptance.service.js';
import type { IMarketRecoveryStore, IMarketSingleFlight } from '../../../../services/market/action.types.js';
import { MarketApiClient } from '../../../../services/market/client.js';
import { MarketFulfilmentProof } from '../../../../services/market/fulfilment-proof.js';
import type { IFulfilmentTransactionReader } from '../../../../services/market/fulfilment-proof.types.js';
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
import { createAcceptCellOfferTool } from '../accept-offer.js';

export const SELLER = `0x${'1'.repeat(40)}`;

export const BUYER = `0x${'2'.repeat(40)}`;

export const STRANGER = `0x${'3'.repeat(40)}`;

export const CURRENCY_ADDRESS = `0x${'4'.repeat(40)}`;

export const COLLECTION = `0x${'5'.repeat(40)}`;

export const OTHER_CONTRACT = `0x${'6'.repeat(40)}`;

export const CONDUIT = `0x${'7'.repeat(40)}`;

export const CONDUIT_KEY = `0x${'7'.repeat(64)}`;

export const OTHER_CONDUIT_KEY = `0x${'9'.repeat(64)}`;

export const CONDUIT_REGISTRY = `0x${'8'.repeat(40)}`;

export const ZONE = zeroAddress;

export const CURRENCY = { address: CURRENCY_ADDRESS, symbol: 'WETH', decimals: 18 };

export const TOKEN_ID = '1234';

export const OTHER_TOKEN_ID = '4321';

export const AMOUNT = '900000000000000000';

export const ORDER_HASH = `0x${'e'.repeat(64)}`;

export const OTHER_ORDER_HASH = `0x${'d'.repeat(64)}`;

export const NOW_SECONDS = 1_800_000_000;

export const EXPIRES_AT = NOW_SECONDS + 86_400;

export const PREPARE_PATH = '/api/v1/market/offers/accept/prepare';

export const FULFILMENT_CALLDATA = '0xe7acab24';

export const BARE_APPROVAL_SELECTOR = '0xa22cb465';

export function approvalData(operator: string = CONDUIT, approved = true): Hex {
    return encodeFunctionData({
        abi: ERC721_OPERATOR_ABI,
        functionName: 'setApprovalForAll',
        args: [operator as Address, approved],
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

export function offerWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    const amount = typeof over.amount === 'string' ? over.amount : AMOUNT;
    const startsAt = typeof over.startTime === 'number' ? over.startTime : NOW_SECONDS - 60;
    const expiresAt = typeof over.expirationTime === 'number' ? over.expirationTime : EXPIRES_AT;
    const { amount: _amount, startTime: _startTime, expirationTime: _expirationTime, ...wireOver } = over;

    return {
        orderHash: ORDER_HASH,
        protocolAddress: SEAPORT_ADDRESS,
        maker: BUYER,
        kind: MarketOfferKind.Item,
        tokenId: TOKEN_ID,
        price: {
            currencyAddress: CURRENCY_ADDRESS,
            symbol: CURRENCY.symbol,
            decimals: CURRENCY.decimals,
            amountBaseUnits: amount,
        },
        startsAt,
        expiresAt,
        ...wireOver,
    };
}

export function traitOfferWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return offerWire({ kind: MarketOfferKind.Trait, tokenId: TOKEN_ID, ...over });
}

export function collectionOfferWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return offerWire({ kind: MarketOfferKind.Collection, tokenId: TOKEN_ID, ...over });
}

export function fulfilmentWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        kind: 'fulfillment',
        to: SEAPORT_ADDRESS,
        data: FULFILMENT_CALLDATA,
        value: '0',
        chainId: LAUNCH_CHAIN_ID,
        ...over,
    };
}

export function approvalWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        kind: MarketTransactionKind.CollectionApproval,
        to: COLLECTION,
        data: approvalData(),
        value: '0',
        chainId: LAUNCH_CHAIN_ID,
        ...over,
    };
}

export function preparedWire(over: Record<string, unknown> = {}): Record<string, unknown> {
    const baseOffer = (over.offer as Record<string, unknown> | undefined) ?? offerWire();
    const offer = {
        ...baseOffer,
        ...(typeof over.tokenId === 'string' || over.tokenId === null ? { tokenId: over.tokenId } : {}),
        ...(typeof over.protocolAddress === 'string' ? { protocolAddress: over.protocolAddress } : {}),
        ...(typeof over.expiresAt === 'number' ? { expiresAt: over.expiresAt } : {}),
    };

    return {
        offer,
        transactions: (over.transactions as Array<Record<string, unknown>> | undefined) ?? [
            approvalWire(),
            fulfilmentWire(),
        ],
    };
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
        recipient: SELLER,
        offerer: BUYER,
        cell: TOKEN_ID,
        ...over,
    };
    const moved =
        shape.cell === null
            ? []
            : [
                  {
                      itemType: 2,
                      token: COLLECTION as Address,
                      identifier: BigInt(shape.cell),
                      amount: 1n,
                      recipient: shape.offerer as Address,
                  },
              ];

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
            [],
            moved,
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

    constructor(private readonly sender: string | null = SELLER) {}

    async senderOf(hash: string): Promise<string | null> {
        this.asked.push(hash);
        return this.sender;
    }
}

export interface FakeSellerWalletOptions {
    chainId: number;
    owner: string;
    newOwner: string;
    transfers: Array<string>;
    /** Null lets the wallet emit the fulfilment log for the Cell that receipt actually transfers. */
    logs: Array<Log> | null;
    sendFailsAt: number | null;
    receiptFailsAt: number | null;
    revertsAt: number | null;
    cellReadFailsAt: number | null;
    conduitKnown: boolean;
    protocolReadFails: boolean;
}

export class FakeSellerWallet implements WalletManager, WalletProvider {
    async getTransactionSender(): Promise<Address | null> {
        return this.getAddress();
    }
    readonly log: Array<string> = [];
    readonly sent: Array<TransactionRequest> = [];
    readonly reads: Array<ReadContractParams> = [];
    private readonly options: FakeSellerWalletOptions;
    private readonly owners = new Map<string, string>();
    private readonly pending: Array<string>;
    private readonly fulfilmentHashes = new Set<string>();
    private sends = 0;
    private receipts = 0;
    private cellReads = 0;

    constructor(over: Partial<FakeSellerWalletOptions> = {}) {
        this.options = {
            chainId: LAUNCH_CHAIN_ID,
            owner: SELLER,
            newOwner: BUYER,
            transfers: [TOKEN_ID],
            logs: null,
            sendFailsAt: null,
            receiptFailsAt: null,
            revertsAt: null,
            cellReadFailsAt: null,
            conduitKnown: true,
            protocolReadFails: false,
            ...over,
        };
        this.pending = [...this.options.transfers];
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

        const hash = txHash(this.sends);
        if (tx.to?.toLowerCase() === SEAPORT_ADDRESS.toLowerCase()) {
            this.fulfilmentHashes.add(hash);
        }
        return hash as Hash;
    }

    async waitForReceipt(hash: Hash): Promise<TxReceipt> {
        this.receipts += 1;
        this.log.push(`receipt:${hash}`);
        if (this.options.receiptFailsAt === this.receipts) {
            throw new Error('the receipt could not be read');
        }

        const reverted = this.options.revertsAt === this.receipts;
        let moved: string | undefined;
        if (!reverted && this.fulfilmentHashes.delete(hash)) {
            moved = this.pending.shift();
            if (moved !== undefined) {
                this.owners.set(moved, this.options.newOwner);
            }
        }

        return {
            status: reverted ? TxStatus.Reverted : TxStatus.Success,
            transactionHash: hash,
            blockNumber: 1n,
            logs: this.options.logs ?? [orderFulfilledLog({ cell: moved ?? TOKEN_ID })],
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
            if (
                this.options.conduitKnown &&
                typeof params.args[0] === 'string' &&
                params.args[0].toLowerCase() === CONDUIT.toLowerCase()
            ) {
                return CONDUIT_KEY;
            }
            throw new Error('the operator is not registered');
        }

        this.cellReads += 1;
        if (this.options.cellReadFailsAt === this.cellReads) {
            throw new Error('the collection contract could not be read');
        }

        const tokenId = String(params.args[0]);
        return this.owners.get(tokenId) ?? this.options.owner;
    }

    async signTypedData(_request: SignTypedDataRequest): Promise<Hex> {
        throw new Error('accepting an offer signs nothing');
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

export interface AcceptOfferHarnessOver {
    wallet: FakeSellerWallet;
    reader: FakeTransactionReader;
    recovery: IMarketRecoveryStore;
    singleFlight: IMarketSingleFlight;
    appConfig: IAppConfig;
}

export interface AcceptOfferHarness {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
    handler: (args: never) => Promise<ToolResult>;
    transport: FakeMarketTransport;
    wallet: FakeSellerWallet;
    reader: FakeTransactionReader;
    recovery: IMarketRecoveryStore;
    service: MarketAcceptanceService;
}

export function acceptOfferHarness(
    transport: FakeMarketTransport = transportOf(),
    over: Partial<AcceptOfferHarnessOver> = {},
): AcceptOfferHarness {
    const logger = new NoopLogger();
    const wallet = over.wallet ?? new FakeSellerWallet();
    const reader = over.reader ?? new FakeTransactionReader();
    const recovery = over.recovery ?? new MarketRecoveryStore();
    const service = new MarketAcceptanceService({
        client: new MarketApiClient({ api: transport, logger }),
        proof: new MarketFulfilmentProof({ transactions: reader, logger }),
        appConfig: over.appConfig ?? new FakeAppConfig(),
        wallet,
        network: 'arbitrum',
        singleFlight: over.singleFlight ?? new MarketSingleFlight(),
        recovery,
        logger,
    });

    const definition = createAcceptCellOfferTool({ marketAcceptance: service });
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

export function acceptOfferArgs(over: Record<string, unknown> = {}): never {
    return { orderHash: ORDER_HASH, tokenId: null, ...over } as never;
}

export function parsed(result: ToolResult): Record<string, unknown> {
    return JSON.parse(result.content[1]?.text ?? '{}') as Record<string, unknown>;
}

export function summary(result: ToolResult): string {
    return result.content[0]?.text ?? '';
}
