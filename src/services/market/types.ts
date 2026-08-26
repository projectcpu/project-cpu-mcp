import { z } from 'zod';

import type { HttpMethod, RequestOptions } from '../../api/client.js';
import type { ApiResponse } from '../../api/types.js';
import type { ILogger } from '../../logger/types.js';

export enum MarketOfferKind {
    Item = 'item',
    Trait = 'trait',
    Collection = 'collection',
}

export enum MarketOrderKind {
    Listing = 'listing',
    Offer = 'offer',
}

export enum MarketTransactionKind {
    CollectionApproval = 'collectionApproval',
    CurrencyApproval = 'currencyApproval',
    Fulfilment = 'fulfilment',
    Cancellation = 'cancellation',
}

export enum MarketActionStatus {
    Completed = 'completed',
    AlreadyCompleted = 'already_completed',
}

export enum MarketActionStage {
    Read = 'read',
    Reconcile = 'reconcile',
    Prepare = 'prepare',
    Approve = 'approve',
    Sign = 'sign',
    Submit = 'submit',
    Fulfil = 'fulfil',
    Cancel = 'cancel',
    Verify = 'verify',
}

export enum MarketErrorCode {
    UpstreamRateLimited = 'upstreamRateLimited',
    PreparedIntentInProgress = 'preparedIntentInProgress',
    PreparedIntentNotFound = 'preparedIntentNotFound',
    PreparedIntentFlowMismatch = 'preparedIntentFlowMismatch',
    PreparedIntentExpired = 'PREPARED_INTENT_EXPIRED',
    OrderUnavailable = 'ORDER_UNAVAILABLE',
    ActiveOrderExists = 'ACTIVE_ORDER_EXISTS',
    OutcomeUnknown = 'OUTCOME_UNKNOWN',
    UnresolvedCapacityFull = 'UNRESOLVED_CAPACITY_FULL',
    InvalidInput = 'INVALID_INPUT',
    InvalidMarketResponse = 'INVALID_MARKET_RESPONSE',
    WrongOwner = 'WRONG_OWNER',
    CurrencyUnsupported = 'CURRENCY_UNSUPPORTED',
    ChainMismatch = 'CHAIN_MISMATCH',
    ProtocolAddressMismatch = 'PROTOCOL_ADDRESS_MISMATCH',
    SignatureMismatch = 'SIGNATURE_MISMATCH',
    TransactionReverted = 'TRANSACTION_REVERTED',
    Unauthorized = 'UNAUTHORIZED',
    NetworkFailure = 'NETWORK_FAILURE',
    ServiceUnavailable = 'SERVICE_UNAVAILABLE',
    MarketRequestFailed = 'MARKET_REQUEST_FAILED',
}

export const cellTokenIdSchema = z
    .string()
    .regex(/^[1-9][0-9]*$/, 'Cell token id must be a decimal integer without leading zeroes.');

export const baseUnitAmountSchema = z
    .string()
    .regex(/^(0|[1-9][0-9]*)$/, 'Amounts are non-negative decimal integer base-unit strings.');

export const positiveBaseUnitAmountSchema = z
    .string()
    .regex(/^[1-9][0-9]*$/, 'Amounts are positive decimal integer base-unit strings.');

export const evmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Expected a 20-byte 0x-prefixed address.');

export const bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Expected a 32-byte 0x-prefixed hex value.');

export const orderHashSchema = bytes32Schema;

export const transactionHashSchema = bytes32Schema;

export const hexDataSchema = z.string().regex(/^0x([0-9a-fA-F]{2})*$/, 'Expected 0x-prefixed calldata.');

export const prepareIdSchema = z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'A prepare id is 64 lowercase hex characters without a 0x prefix.');

export const unixSecondsSchema = z.number().int().nonnegative();

export const chainIdSchema = z.number().int().positive();

export const cursorSchema = z.string().min(1);

export const marketCurrencySchema = z.object({
    address: evmAddressSchema,
    symbol: z.string().min(1),
    decimals: z.number().int().nonnegative(),
});

export const marketListingSchema = z.object({
    orderHash: orderHashSchema,
    protocolAddress: evmAddressSchema,
    chainId: chainIdSchema,
    maker: evmAddressSchema,
    tokenId: cellTokenIdSchema,
    price: baseUnitAmountSchema,
    currency: marketCurrencySchema,
    startTime: unixSecondsSchema,
    expirationTime: unixSecondsSchema,
});

export const marketOfferSchema = z.object({
    orderHash: orderHashSchema,
    protocolAddress: evmAddressSchema,
    chainId: chainIdSchema,
    maker: evmAddressSchema,
    kind: z.nativeEnum(MarketOfferKind),
    tokenId: cellTokenIdSchema.nullable(),
    amount: baseUnitAmountSchema,
    currency: marketCurrencySchema,
    startTime: unixSecondsSchema,
    expirationTime: unixSecondsSchema,
});

export const cellMarketSnapshotSchema = z.object({
    tokenId: cellTokenIdSchema,
    bestListing: marketListingSchema.nullable(),
    bestOffer: marketOfferSchema.nullable(),
});

export const marketFeeBreakdownSchema = z.object({
    platformFee: baseUnitAmountSchema,
    creatorFee: baseUnitAmountSchema,
    estimatedProceeds: baseUnitAmountSchema,
});

export const marketTransactionSchema = z.object({
    kind: z.nativeEnum(MarketTransactionKind),
    to: evmAddressSchema,
    data: hexDataSchema,
    value: baseUnitAmountSchema,
    chainId: chainIdSchema,
});

export const marketPreparedIntentSchema = z.object({
    prepareId: prepareIdSchema,
    expiresAt: unixSecondsSchema,
    chainId: chainIdSchema,
    protocolAddress: evmAddressSchema,
});

export const seaportOfferItemSchema = z.object({
    itemType: z.number().int().nonnegative(),
    token: evmAddressSchema,
    identifierOrCriteria: baseUnitAmountSchema,
    startAmount: baseUnitAmountSchema,
    endAmount: baseUnitAmountSchema,
});

export const seaportConsiderationItemSchema = seaportOfferItemSchema.extend({ recipient: evmAddressSchema });

export const seaportOrderComponentsSchema = z.object({
    offerer: evmAddressSchema,
    zone: evmAddressSchema,
    offer: z.array(seaportOfferItemSchema),
    consideration: z.array(seaportConsiderationItemSchema),
    orderType: z.number().int().nonnegative(),
    startTime: baseUnitAmountSchema,
    endTime: baseUnitAmountSchema,
    zoneHash: bytes32Schema,
    salt: baseUnitAmountSchema,
    conduitKey: bytes32Schema,
    counter: baseUnitAmountSchema,
});

export const seaportOrderParametersSchema = seaportOrderComponentsSchema.extend({
    totalOriginalConsiderationItems: z.number().int().nonnegative(),
});

export const marketErrorBodySchema = z.object({ code: z.string().min(1), message: z.string() }).passthrough();

export function marketPageSchema<TItem extends z.ZodTypeAny>(item: TItem) {
    return z.object({ items: z.array(item), nextCursor: cursorSchema.nullable() });
}

export type MarketCurrency = z.infer<typeof marketCurrencySchema>;
export type MarketListing = z.infer<typeof marketListingSchema>;
export type MarketOffer = z.infer<typeof marketOfferSchema>;
export type CellMarketSnapshot = z.infer<typeof cellMarketSnapshotSchema>;
export type MarketFeeBreakdown = z.infer<typeof marketFeeBreakdownSchema>;
export type MarketTransaction = z.infer<typeof marketTransactionSchema>;
export type MarketPreparedIntent = z.infer<typeof marketPreparedIntentSchema>;
export type SeaportOrderComponents = z.infer<typeof seaportOrderComponentsSchema>;
export type SeaportOrderParameters = z.infer<typeof seaportOrderParametersSchema>;
export type MarketErrorBody = z.infer<typeof marketErrorBodySchema>;

export interface MarketErrorOptions {
    code: MarketErrorCode;
    message: string;
    retryable: boolean;
    retryAfterSeconds: number | null;
    stage: MarketActionStage | null;
    txHash: string | null;
}

export interface MarketAttempt {
    startedAt: number;
    index: number;
}

export interface IMarketTransport {
    authenticatedRequest<T>(path: string, options: RequestOptions | null): Promise<ApiResponse<T>>;
}

export interface MarketRequestInput<TSchema extends z.ZodTypeAny> {
    path: string;
    method: HttpMethod;
    body: unknown | null;
    schema: TSchema;
    stage: MarketActionStage;
    label: string;
}

export interface IMarketApiClient {
    send<TSchema extends z.ZodTypeAny>(input: MarketRequestInput<TSchema>): Promise<z.infer<TSchema>>;
}

export interface MarketApiClientOptions {
    api: IMarketTransport;
    logger: ILogger;
}

export interface MarketServiceOptions {
    client: IMarketApiClient;
    logger: ILogger;
}

export interface IMarketService {
    getCellMarket(tokenId: string): Promise<CellMarketSnapshot>;
}
