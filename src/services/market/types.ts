import { z } from 'zod';

import type { HttpMethod, RequestOptions } from '../../api/client.js';
import type { ApiResponse } from '../../api/types.js';
import type { ILogger } from '../../logger/types.js';

const MAX_BASE_UNITS = 2n ** 256n - 1n;
const MAX_LAND_TOKEN_ID = 2_147_483_647n;
const MAX_MARKET_LOOKUP_TOKEN_ID = 9_223_372_036_854_775_807n;
const MAX_MARKET_TIMESTAMP = 253_402_300_799;
const MAX_MARKET_CURSOR_LENGTH = 512;
const CANONICAL_INTEGER_PATTERN = /^(0|[1-9][0-9]*)$/;

const canonicalIntegerStringSchema = (minimum: bigint, maximum: bigint, label: string) =>
    z
        .string()
        .regex(CANONICAL_INTEGER_PATTERN, `${label} must be a canonical non-negative decimal integer string.`)
        .refine((value) => {
            if (!CANONICAL_INTEGER_PATTERN.test(value)) {
                return false;
            }
            const integer = BigInt(value);
            return integer >= minimum && integer <= maximum;
        }, `${label} is outside the supported range.`);

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
    Fulfillment = 'fulfillment',
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
    StaleListing = 'staleListing',
    StaleOffer = 'staleOffer',
    Unfulfillable = 'unfulfillable',
    NotOwner = 'notOwner',
    CurrencyNotConfigured = 'currencyNotConfigured',
    UpstreamRateLimited = 'upstreamRateLimited',
    UpstreamRejected = 'upstreamRejected',
    UpstreamUnavailable = 'upstreamUnavailable',
    InvalidRequest = 'invalidRequest',
    PreparedIntentInProgress = 'preparedIntentInProgress',
    PreparedIntentNotFound = 'preparedIntentNotFound',
    PreparedIntentFlowMismatch = 'preparedIntentFlowMismatch',
    PreparedIntentExpired = 'PREPARED_INTENT_EXPIRED',
    OrderUnavailable = 'ORDER_UNAVAILABLE',
    ActiveOrderExists = 'ACTIVE_ORDER_EXISTS',
    OutcomeUnknown = 'OUTCOME_UNKNOWN',
    UnresolvedCapacityFull = 'UNRESOLVED_CAPACITY_FULL',
    InvalidInput = 'INVALID_INPUT',
    InsufficientBalance = 'INSUFFICIENT_BALANCE',
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

export const cellTokenIdSchema = canonicalIntegerStringSchema(0n, MAX_LAND_TOKEN_ID, 'Cell token id');

export const marketLookupTokenIdSchema = canonicalIntegerStringSchema(
    0n,
    MAX_MARKET_LOOKUP_TOKEN_ID,
    'Market Cell lookup token id',
);

export const baseUnitAmountSchema = canonicalIntegerStringSchema(0n, MAX_BASE_UNITS, 'Base-unit amount');

export const positiveBaseUnitAmountSchema = canonicalIntegerStringSchema(1n, MAX_BASE_UNITS, 'Base-unit amount');

export const evmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/, 'Expected a 20-byte 0x-prefixed address.');

export const bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Expected a 32-byte 0x-prefixed hex value.');

export const orderHashSchema = bytes32Schema;

export const transactionHashSchema = bytes32Schema;

export const hexDataSchema = z.string().regex(/^0x([0-9a-fA-F]{2})*$/, 'Expected 0x-prefixed calldata.');

export const prepareIdSchema = z
    .string()
    .regex(/^[0-9a-f]{64}$/, 'A prepare id is 64 lowercase hex characters without a 0x prefix.');

export const unixSecondsSchema = z.number().int().min(0).max(MAX_MARKET_TIMESTAMP);

export const chainIdSchema = z.number().int().positive();

export const cursorSchema = z.string().min(1).max(MAX_MARKET_CURSOR_LENGTH);

export const marketCurrencySchema = z.object({
    address: evmAddressSchema,
    symbol: z.string().min(1),
    decimals: z.number().int().min(0).max(36),
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
    itemType: z.number().int().min(0).max(5),
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
    orderType: z.number().int().min(0).max(5),
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

const safeMarketErrorMessageSchema = z
    .string()
    .min(1)
    .max(512)
    .regex(/^[^\u0000-\u001f\u007f-\u009f]*$/, 'Market errors must be one printable line.');

const marketErrorDiagnosticIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/);

export const marketErrorBodySchema = z
    .union([
        z.object({
            success: z.literal(false),
            error: z.string().min(1),
            message: safeMarketErrorMessageSchema,
            reqId: marketErrorDiagnosticIdSchema,
        }),
        z.object({
            statusCode: z.literal(400),
            error: z.literal('Bad Request'),
            message: z.array(safeMarketErrorMessageSchema).min(1).max(32),
        }),
    ])
    .transform((body) => {
        if ('success' in body) {
            return {
                code: body.error,
                message: `${body.message} Diagnostic id: ${body.reqId}.`,
            };
        }
        return {
            code: MarketErrorCode.InvalidInput,
            message: `Request validation failed: ${body.message.join('; ')}.`,
        };
    });

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

export enum MarketWaitRefusal {
    BudgetSpent = 'budgetSpent',
    DeadlineWouldPass = 'deadlineWouldPass',
}

export interface MarketWaitBudgetOptions {
    totalMs: number;
    deadlineAtSeconds: number | null;
}

export interface IMarketWaitBudget {
    readonly remainingMs: number;
    readonly deadlineAtSeconds: number | null;
    narrowDeadlineSeconds(deadlineAtSeconds: number): void;
    refuse(delayMs: number): MarketWaitRefusal | null;
    wait(delayMs: number): Promise<void>;
    waitAtMost(delayMs: number): Promise<number>;
}

export interface MarketAttempt {
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

export interface MarketBudgetedRequest<TSchema extends z.ZodTypeAny> extends MarketRequestInput<TSchema> {
    budget: IMarketWaitBudget;
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
