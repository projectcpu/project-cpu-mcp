import type { Address, Hex } from 'viem';

import { MarketActionTool, type IMarketRecoveryStore, type IMarketSingleFlight } from './action.types.js';
import { MS_PER_SECOND } from './constants.js';
import { MarketError } from './error.js';
import { marketActionKey } from './idempotency.utils.js';
import {
    LISTING_SUBMIT_MAX_ATTEMPTS,
    MARKET_LISTING_PREPARE_PATH,
    MARKET_LISTING_SUBMIT_PATH,
} from './listing.constants.js';
import {
    prepareListingResponseSchema,
    submitListingResponseSchema,
    type IMarketListingService,
    type ListCellRequest,
    type ListCellResult,
    type ListingRecoveryPayload,
    type MarketListingServiceOptions,
    type PrepareListingResponse,
} from './listing.types.js';
import {
    currencyConsiderationTotal,
    effectiveListingDeadline,
    isEquivalentActiveListing,
    listingActionInputs,
    sameAddress,
    sameOptionalAddress,
    seaportSignableOrder,
    sumBaseUnits,
} from './listing.utils.js';
import type { IMarketProfileReader } from './profile.schemas.js';
import { MARKET_PROFILE_CACHE_MS, MARKET_RECONCILE_MAX_PAGES } from './recovery.constants.js';
import {
    cellTokenIdSchema,
    evmAddressSchema,
    MarketActionStage,
    MarketActionStatus,
    MarketErrorCode,
    MarketTransactionKind,
    positiveBaseUnitAmountSchema,
    unixSecondsSchema,
    type IMarketApiClient,
    type MarketListing,
    type MarketTransaction,
} from './types.js';
import {
    SEAPORT_ADDRESS,
    SEAPORT_DOMAIN_NAME,
    SEAPORT_DOMAIN_VERSION,
    SEAPORT_ORDER_COMPONENTS_TYPES,
    SEAPORT_ORDER_PRIMARY_TYPE,
} from '../../contracts/seaport.constants.js';
import type { ILogger } from '../../logger/types.js';
import { sleep } from '../../utils/async.utils.js';
import { TxStatus, type WalletProvider } from '../../wallet/types.js';

export class MarketListingService implements IMarketListingService {
    private readonly client: IMarketApiClient;
    private readonly profile: IMarketProfileReader;
    private readonly wallet: WalletProvider;
    private readonly network: string;
    private readonly singleFlight: IMarketSingleFlight;
    private readonly recovery: IMarketRecoveryStore;
    private readonly logger: ILogger;
    private lastProfileReadAt: number | null = null;

    constructor(options: MarketListingServiceOptions) {
        this.client = options.client;
        this.profile = options.profile;
        this.wallet = options.wallet;
        this.network = options.network;
        this.singleFlight = options.singleFlight;
        this.recovery = options.recovery;
        this.logger = options.logger;
    }

    async listCell(request: ListCellRequest): Promise<ListCellResult> {
        const validated = this.requireUsableRequest(request);
        const key = marketActionKey({
            wallet: this.walletAddress(),
            network: this.network,
            tool: MarketActionTool.ListCell,
            inputs: listingActionInputs(validated),
        });

        return this.singleFlight.run(key, async () => this.publish(key, validated));
    }

    private async publish(key: string, request: ListCellRequest): Promise<ListCellResult> {
        const unresolved = this.recovery.read<ListingRecoveryPayload>(key);
        if (unresolved !== null && unresolved.payload.prepared !== null) {
            return this.resume(key, request, unresolved.payload);
        }

        this.reserve(key, MarketActionStage.Reconcile, this.emptyPayload());

        let payload = this.emptyPayload();
        try {
            await this.requireNoEquivalentActiveListing(request);

            const prepared = await this.prepare(request);
            payload = { prepared, signature: null, approvalTxHashes: [] };
            this.reserve(key, MarketActionStage.Prepare, payload);

            payload = { ...payload, approvalTxHashes: await this.broadcastApprovals(prepared) };
            this.reserve(key, MarketActionStage.Approve, payload);

            payload = { ...payload, signature: await this.sign(prepared) };
            this.reserve(key, MarketActionStage.Sign, payload);
        } catch (error) {
            this.recovery.forget(key);
            throw error;
        }

        return this.submit(key, request, payload);
    }

    private async resume(
        key: string,
        request: ListCellRequest,
        payload: ListingRecoveryPayload,
    ): Promise<ListCellResult> {
        const prepared = payload.prepared;
        if (prepared === null) {
            this.recovery.forget(key);
            return this.publish(key, request);
        }

        if (this.nowSeconds() >= effectiveListingDeadline(prepared)) {
            return this.reconcileExpired(key, request, prepared);
        }

        if (payload.signature === null) {
            const resumed = {
                ...payload,
                approvalTxHashes: await this.broadcastApprovals(prepared),
            };
            const signed = { ...resumed, signature: await this.sign(prepared) };
            this.reserve(key, MarketActionStage.Sign, signed);
            return this.submit(key, request, signed);
        }

        return this.submit(key, request, payload);
    }

    private async submit(
        key: string,
        request: ListCellRequest,
        payload: ListingRecoveryPayload,
    ): Promise<ListCellResult> {
        const prepared = this.requirePrepared(payload);

        for (let attempt = 1; attempt <= LISTING_SUBMIT_MAX_ATTEMPTS; attempt += 1) {
            this.requireWithinDeadline(prepared, MarketActionStage.Submit);

            try {
                const response = await this.client.send({
                    path: MARKET_LISTING_SUBMIT_PATH,
                    method: 'POST',
                    body: { prepareId: prepared.prepareId, signature: payload.signature },
                    schema: submitListingResponseSchema,
                    stage: MarketActionStage.Submit,
                    label: `Publishing the listing for Cell ${request.tokenId}`,
                });

                this.recovery.forget(key);
                return this.result(MarketActionStatus.Completed, request, payload, response.listing);
            } catch (error) {
                if (error instanceof MarketError && !error.retryable) {
                    this.recovery.forget(key);
                    throw error;
                }

                this.reserve(key, MarketActionStage.Submit, payload);
                this.logger.warn('the listing submit left an uncertain outcome — reconciling before any retry', {
                    tokenId: request.tokenId,
                    attempt,
                });

                const published = await this.reconcile(request, MarketActionStage.Submit);
                if (published !== null) {
                    this.recovery.forget(key);
                    return this.result(MarketActionStatus.AlreadyCompleted, request, payload, published);
                }
            }
        }

        throw this.outcomeUnknown(request, MarketActionStage.Submit);
    }

    private async reconcileExpired(
        key: string,
        request: ListCellRequest,
        prepared: PrepareListingResponse,
    ): Promise<ListCellResult> {
        const published = await this.reconcile(request, MarketActionStage.Reconcile);
        if (published !== null) {
            this.recovery.forget(key);
            return this.result(
                MarketActionStatus.AlreadyCompleted,
                request,
                { prepared, signature: null, approvalTxHashes: [] },
                published,
            );
        }

        this.recovery.forget(key);
        throw new MarketError({
            code: MarketErrorCode.PreparedIntentExpired,
            message:
                `The prepared listing for Cell ${request.tokenId} ran out of time before it could be published, ` +
                'and no matching listing is active. Call the tool again to prepare a fresh listing.',
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Reconcile,
            txHash: null,
        });
    }

    private async reconcile(request: ListCellRequest, stage: MarketActionStage): Promise<MarketListing | null> {
        await this.waitForProfileCacheHorizon();

        try {
            return await this.findEquivalentActiveListing(request);
        } catch (error) {
            this.logger.error('cannot reconcile an uncertain listing against the marketplace', {
                tokenId: request.tokenId,
                error,
            });
            throw this.outcomeUnknown(request, stage);
        }
    }

    private async requireNoEquivalentActiveListing(request: ListCellRequest): Promise<void> {
        const active = await this.findEquivalentActiveListing(request);
        if (active === null) {
            return;
        }

        throw new MarketError({
            code: MarketErrorCode.ActiveOrderExists,
            message:
                `Cell ${request.tokenId} already carries an active listing of yours at this price and expiry ` +
                `(order ${active.orderHash}). A public listing and a listing reserved for one buyer look the same ` +
                'from outside, so publishing another one could duplicate your order. Cancel that order first if ' +
                'you meant to replace it.',
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Reconcile,
            txHash: null,
        });
    }

    private async findEquivalentActiveListing(request: ListCellRequest): Promise<MarketListing | null> {
        const wallet = this.walletAddress();
        let cursor: string | null = null;

        for (let page = 0; page < MARKET_RECONCILE_MAX_PAGES; page += 1) {
            const listings = await this.profile.getMyListings(cursor);
            this.lastProfileReadAt = Date.now();

            const match = listings.items.find((listing) => isEquivalentActiveListing(listing, request, wallet));
            if (match !== undefined) {
                return match;
            }

            cursor = listings.nextCursor;
            if (cursor === null) {
                return null;
            }
        }

        return null;
    }

    private async waitForProfileCacheHorizon(): Promise<void> {
        if (this.lastProfileReadAt === null) {
            return;
        }

        const remaining = MARKET_PROFILE_CACHE_MS - (Date.now() - this.lastProfileReadAt);
        if (remaining > 0) {
            this.logger.info('waiting for the marketplace read snapshot to advance before reconciling', { remaining });
            await sleep(remaining);
        }
    }

    private async prepare(request: ListCellRequest): Promise<PrepareListingResponse> {
        const body: Record<string, unknown> = {
            tokenId: request.tokenId,
            price: request.price,
            expirationTime: request.expirationTime,
        };
        if (request.buyerAddress !== null) {
            body.buyerAddress = request.buyerAddress;
        }

        const prepared = await this.client.send({
            path: MARKET_LISTING_PREPARE_PATH,
            method: 'POST',
            body,
            schema: prepareListingResponseSchema,
            stage: MarketActionStage.Prepare,
            label: `Preparing the listing for Cell ${request.tokenId}`,
        });

        this.requireTrustworthyPreparation(request, prepared);
        return prepared;
    }

    private requireTrustworthyPreparation(request: ListCellRequest, prepared: PrepareListingResponse): void {
        const wallet = this.walletAddress();
        const chainId = this.wallet.get().getChainId();

        if (prepared.chainId !== chainId) {
            throw this.untrustworthy(
                MarketErrorCode.ChainMismatch,
                `it targets chain ${prepared.chainId} while this wallet signs for chain ${chainId}`,
                request,
            );
        }
        if (!sameAddress(prepared.protocolAddress, SEAPORT_ADDRESS)) {
            throw this.untrustworthy(
                MarketErrorCode.ProtocolAddressMismatch,
                `it names protocol contract ${prepared.protocolAddress} instead of the pinned ${SEAPORT_ADDRESS}`,
                request,
            );
        }
        if (!sameAddress(prepared.listing.maker, wallet) || !sameAddress(prepared.order.offerer, wallet)) {
            throw this.untrustworthy(
                MarketErrorCode.WrongOwner,
                `it sells on behalf of ${prepared.listing.maker} rather than this wallet ${wallet}`,
                request,
            );
        }

        this.requireRequestedTerms(request, prepared);
        this.requireFeeArithmetic(request, prepared);
        this.requireApprovalsOnly(request, prepared);
        this.requireSignableOrder(request, prepared);
    }

    private requireRequestedTerms(request: ListCellRequest, prepared: PrepareListingResponse): void {
        const listing = prepared.listing;

        if (listing.tokenId !== request.tokenId) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it sells Cell ${listing.tokenId} instead of Cell ${request.tokenId}`,
                request,
            );
        }
        if (listing.price !== request.price) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `its gross price is ${listing.price} instead of the requested ${request.price}`,
                request,
            );
        }
        if (listing.expirationTime !== request.expirationTime) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it expires at ${listing.expirationTime} instead of the requested ${request.expirationTime}`,
                request,
            );
        }
        if (!sameOptionalAddress(listing.buyerAddress, request.buyerAddress)) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `its reserved buyer is ${listing.buyerAddress ?? 'nobody'} instead of ` +
                    `${request.buyerAddress ?? 'nobody'}`,
                request,
            );
        }
    }

    private requireFeeArithmetic(request: ListCellRequest, prepared: PrepareListingResponse): void {
        const fees = prepared.fees;
        const total = sumBaseUnits([fees.platformFee, fees.creatorFee, fees.estimatedProceeds]);

        if (total !== prepared.listing.price) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `its platform fee, creator fee and proceeds add up to ${total} rather than the gross price ` +
                    `${prepared.listing.price}`,
                request,
            );
        }
    }

    private requireApprovalsOnly(request: ListCellRequest, prepared: PrepareListingResponse): void {
        const chainId = this.wallet.get().getChainId();
        const foreign = prepared.transactions.find(
            (transaction) =>
                transaction.kind !== MarketTransactionKind.CollectionApproval || transaction.chainId !== chainId,
        );

        if (foreign !== undefined) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `publishing a listing may only need collection approvals, but it asks to send a "${foreign.kind}" ` +
                    `transaction on chain ${foreign.chainId}`,
                request,
            );
        }
    }

    private requireSignableOrder(request: ListCellRequest, prepared: PrepareListingResponse): void {
        const order = prepared.order;
        const sold = order.offer.length === 1 ? (order.offer[0] ?? null) : null;

        if (sold === null || sold.identifierOrCriteria !== request.tokenId) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign does not offer exactly Cell ${request.tokenId}`,
                request,
            );
        }
        if (order.endTime !== request.expirationTime.toString()) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign ends at ${order.endTime} instead of ${request.expirationTime}`,
                request,
            );
        }

        const paid = currencyConsiderationTotal(order, prepared.listing.currency.address);
        if (paid !== prepared.listing.price) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign collects ${paid} for the seller side rather than the gross ` +
                    `price ${prepared.listing.price}`,
                request,
            );
        }
    }

    private async broadcastApprovals(prepared: PrepareListingResponse): Promise<Array<string>> {
        const hashes: Array<string> = [];

        for (const transaction of prepared.transactions) {
            hashes.push(await this.broadcast(transaction));
        }

        return hashes;
    }

    private async broadcast(transaction: MarketTransaction): Promise<string> {
        const wallet = this.wallet.get();
        const hash = await wallet.sendTransaction({
            to: transaction.to as Address,
            data: transaction.data as Hex,
            value: BigInt(transaction.value),
            gas: null,
        });

        const receipt = await wallet.waitForReceipt(hash);
        if (receipt.status !== TxStatus.Success) {
            throw new MarketError({
                code: MarketErrorCode.TransactionReverted,
                message:
                    `The collection approval this listing needs reverted on-chain, so the listing was never ` +
                    'signed or published.',
                retryable: false,
                retryAfterSeconds: null,
                stage: MarketActionStage.Approve,
                txHash: hash,
            });
        }

        return hash;
    }

    private async sign(prepared: PrepareListingResponse): Promise<string> {
        this.requireWithinDeadline(prepared, MarketActionStage.Sign);

        return this.wallet.get().signTypedData({
            domain: {
                name: SEAPORT_DOMAIN_NAME,
                version: SEAPORT_DOMAIN_VERSION,
                chainId: prepared.chainId,
                verifyingContract: prepared.protocolAddress as Address,
            },
            types: SEAPORT_ORDER_COMPONENTS_TYPES,
            primaryType: SEAPORT_ORDER_PRIMARY_TYPE,
            message: seaportSignableOrder(prepared.order),
        });
    }

    private requireWithinDeadline(prepared: PrepareListingResponse, stage: MarketActionStage): void {
        if (this.nowSeconds() < effectiveListingDeadline(prepared)) {
            return;
        }

        throw new MarketError({
            code: MarketErrorCode.PreparedIntentExpired,
            message:
                'This prepared listing is past the earlier of its own deadline and the order expiry, so it can no ' +
                'longer be signed or published. Call the tool again to prepare a fresh listing.',
            retryable: false,
            retryAfterSeconds: null,
            stage,
            txHash: null,
        });
    }

    private requirePrepared(payload: ListingRecoveryPayload): PrepareListingResponse {
        if (payload.prepared === null) {
            throw new MarketError({
                code: MarketErrorCode.InvalidMarketResponse,
                message: 'The listing has no prepared order to publish.',
                retryable: false,
                retryAfterSeconds: null,
                stage: MarketActionStage.Submit,
                txHash: null,
            });
        }

        return payload.prepared;
    }

    private requireUsableRequest(request: ListCellRequest): ListCellRequest {
        const tokenId = cellTokenIdSchema.safeParse(request.tokenId);
        if (!tokenId.success) {
            throw this.rejectedInput(
                `"${request.tokenId}" is not a canonical Cell token id. Pass a decimal integer with no leading ` +
                    'zeroes so that one Cell keeps one identity.',
            );
        }

        const price = positiveBaseUnitAmountSchema.safeParse(request.price);
        if (!price.success) {
            throw this.rejectedInput(
                `"${request.price}" is not a listing price. Pass the gross amount a buyer pays as a positive ` +
                    'decimal integer of the currency base units, never a decimal fraction.',
            );
        }

        const expirationTime = unixSecondsSchema.safeParse(request.expirationTime);
        if (!expirationTime.success || expirationTime.data <= this.nowSeconds()) {
            throw this.rejectedInput(
                `${request.expirationTime} is not a future expiry. Pass the Unix second at which the listing ` +
                    'should stop being fillable.',
            );
        }

        const buyerAddress = request.buyerAddress;
        if (buyerAddress !== null && !evmAddressSchema.safeParse(buyerAddress).success) {
            throw this.rejectedInput(
                `"${buyerAddress}" is not an address. Pass the one wallet allowed to buy this listing, or null to ` +
                    'let anyone buy it.',
            );
        }

        return {
            tokenId: tokenId.data,
            price: price.data,
            expirationTime: expirationTime.data,
            buyerAddress,
        };
    }

    private reserve(key: string, stage: MarketActionStage, payload: ListingRecoveryPayload): void {
        this.recovery.write(key, { tool: MarketActionTool.ListCell, stage, payload });
    }

    private emptyPayload(): ListingRecoveryPayload {
        return { prepared: null, signature: null, approvalTxHashes: [] };
    }

    private result(
        status: MarketActionStatus,
        request: ListCellRequest,
        payload: ListingRecoveryPayload,
        listing: MarketListing,
    ): ListCellResult {
        const prepared = this.requirePrepared(payload);

        this.logger.info('the Cell listing is published', {
            tokenId: request.tokenId,
            status,
            orderHash: listing.orderHash,
        });

        return {
            status,
            stage: MarketActionStage.Submit,
            wallet: this.walletAddress(),
            tokenId: request.tokenId,
            listing,
            grossPrice: prepared.listing.price,
            currency: prepared.listing.currency,
            platformFee: prepared.fees.platformFee,
            creatorFee: prepared.fees.creatorFee,
            estimatedProceeds: prepared.fees.estimatedProceeds,
            approvalTxHashes: [...payload.approvalTxHashes],
        };
    }

    private outcomeUnknown(request: ListCellRequest, stage: MarketActionStage): MarketError {
        return new MarketError({
            code: MarketErrorCode.OutcomeUnknown,
            message:
                `The listing for Cell ${request.tokenId} was submitted but its outcome could not be confirmed, and ` +
                'the marketplace cannot be read to settle the question. The exact prepared order is kept, so ' +
                'repeating this call republishes the same order rather than creating a second one.',
            retryable: true,
            retryAfterSeconds: null,
            stage,
            txHash: null,
        });
    }

    private untrustworthy(code: MarketErrorCode, detail: string, request: ListCellRequest): MarketError {
        this.logger.error('the prepared listing does not match the request', { tokenId: request.tokenId, detail });

        return new MarketError({
            code,
            message: `The prepared listing for Cell ${request.tokenId} cannot be signed: ${detail}.`,
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Prepare,
            txHash: null,
        });
    }

    private rejectedInput(message: string): MarketError {
        return new MarketError({
            code: MarketErrorCode.InvalidInput,
            message,
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Prepare,
            txHash: null,
        });
    }

    private walletAddress(): string {
        return this.wallet.get().getAddress();
    }

    private nowSeconds(): number {
        return Math.floor(Date.now() / MS_PER_SECOND);
    }
}
