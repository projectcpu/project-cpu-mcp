import { zeroAddress, zeroHash, type Address, type Hex } from 'viem';

import {
    MarketActionTool,
    type IMarketRecoveryStore,
    type IMarketSingleFlight,
    type MarketRecoveryRecord,
} from './action.types.js';
import type { IMarketSingleShotClient } from './client.types.js';
import { MS_PER_SECOND, PROVEN_UNPUBLISHED_MARKET_ERROR_CODES } from './constants.js';
import { MarketError } from './error.js';
import { marketActionKey } from './idempotency.utils.js';
import {
    LISTING_NO_IDENTIFIER,
    LISTING_SINGLE_UNIT,
    LISTING_START_TIME_SKEW_SECONDS,
    LISTING_SUBMIT_MAX_ATTEMPTS,
    MARKET_LISTING_PREPARE_PATH,
    MARKET_LISTING_SUBMIT_PATH,
} from './listing.constants.js';
import {
    MarketScanOutcome,
    prepareListingResponseSchema,
    submitListingResponseSchema,
    type IMarketListingService,
    type ListCellRequest,
    type ListCellResult,
    type ListingRecoveryPayload,
    type MarketListingScan,
    type MarketListingServiceOptions,
    type PrepareListingResponse,
    type SeaportConsiderationItem,
} from './listing.types.js';
import {
    considerationStartTotal,
    effectiveListingDeadline,
    isEquivalentActiveListing,
    listingActionInputs,
    recipientConsiderationTotal,
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
import { SeaportItemType, SeaportOrderType } from '../../contracts/seaport.types.js';
import type { ILogger } from '../../logger/types.js';
import { sleep } from '../../utils/async.utils.js';
import { TxStatus, type WalletProvider } from '../../wallet/types.js';
import type { IAppConfig } from '../types.js';

export class MarketListingService implements IMarketListingService {
    private readonly client: IMarketSingleShotClient;
    private readonly profile: IMarketProfileReader;
    private readonly appConfig: IAppConfig;
    private readonly wallet: WalletProvider;
    private readonly network: string;
    private readonly singleFlight: IMarketSingleFlight;
    private readonly recovery: IMarketRecoveryStore;
    private readonly logger: ILogger;
    private lastProfileReadAt: number | null = null;

    constructor(options: MarketListingServiceOptions) {
        this.client = options.client;
        this.profile = options.profile;
        this.appConfig = options.appConfig;
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
            return this.resume(key, request, unresolved);
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

        return this.submit(key, request, payload, false);
    }

    private async resume(
        key: string,
        request: ListCellRequest,
        record: MarketRecoveryRecord<ListingRecoveryPayload>,
    ): Promise<ListCellResult> {
        const payload = record.payload;
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
            return this.submit(key, request, signed, false);
        }

        return this.submit(key, request, payload, record.stage === MarketActionStage.Submit);
    }

    private async submit(
        key: string,
        request: ListCellRequest,
        payload: ListingRecoveryPayload,
        submittedBefore: boolean,
    ): Promise<ListCellResult> {
        const prepared = this.requirePrepared(payload);
        let reachedServer = submittedBefore;

        for (let attempt = 1; attempt <= LISTING_SUBMIT_MAX_ATTEMPTS; attempt += 1) {
            this.requireWithinDeadline(prepared, MarketActionStage.Submit);
            const priorSubmission = reachedServer;
            reachedServer = true;

            try {
                const response = await this.client.sendOnce({
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
                if (this.provenUnpublished(error, priorSubmission)) {
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

                if (error instanceof MarketError && !error.retryable) {
                    throw this.outcomeUnknown(request, MarketActionStage.Submit);
                }
            }
        }

        throw this.outcomeUnknown(request, MarketActionStage.Submit);
    }

    private provenUnpublished(error: unknown, priorSubmission: boolean): boolean {
        return (
            !priorSubmission &&
            error instanceof MarketError &&
            !error.retryable &&
            PROVEN_UNPUBLISHED_MARKET_ERROR_CODES.has(error.code)
        );
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

        let scan: MarketListingScan;
        try {
            scan = await this.scanActiveListings(request);
        } catch (error) {
            this.logger.error('cannot reconcile an uncertain listing against the marketplace', {
                tokenId: request.tokenId,
                error,
            });
            throw this.outcomeUnknown(request, stage);
        }

        if (scan.outcome === MarketScanOutcome.Exhausted) {
            this.logger.error('the active listings run past the pages this tool may read, so nothing is settled', {
                tokenId: request.tokenId,
                pages: MARKET_RECONCILE_MAX_PAGES,
            });
            throw this.outcomeUnknown(request, stage);
        }

        return scan.listing;
    }

    private async requireNoEquivalentActiveListing(request: ListCellRequest): Promise<void> {
        const scan = await this.scanActiveListings(request);

        if (scan.outcome === MarketScanOutcome.Exhausted) {
            throw new MarketError({
                code: MarketErrorCode.OutcomeUnknown,
                message:
                    `Your active listings run past the ${MARKET_RECONCILE_MAX_PAGES} pages this tool reads, so it ` +
                    `cannot rule out that Cell ${request.tokenId} already carries an equivalent listing, and it ` +
                    'will not prepare another one blindly. Cancel listings you no longer need, then call the tool ' +
                    'again.',
                retryable: true,
                retryAfterSeconds: null,
                stage: MarketActionStage.Reconcile,
                txHash: null,
            });
        }

        const active = scan.listing;
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

    private async scanActiveListings(request: ListCellRequest): Promise<MarketListingScan> {
        const wallet = this.walletAddress();
        let cursor: string | null = null;

        for (let page = 0; page < MARKET_RECONCILE_MAX_PAGES; page += 1) {
            const listings = await this.profile.getMyListings(cursor);
            this.lastProfileReadAt = Date.now();

            const match = listings.items.find((listing) => isEquivalentActiveListing(listing, request, wallet));
            if (match !== undefined) {
                return { outcome: MarketScanOutcome.Found, listing: match };
            }

            cursor = listings.nextCursor;
            if (cursor === null) {
                return { outcome: MarketScanOutcome.Absent, listing: null };
            }
        }

        return { outcome: MarketScanOutcome.Exhausted, listing: null };
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

        const collection = await this.requireCellCollection();
        const prepared = await this.client.send({
            path: MARKET_LISTING_PREPARE_PATH,
            method: 'POST',
            body,
            schema: prepareListingResponseSchema,
            stage: MarketActionStage.Prepare,
            label: `Preparing the listing for Cell ${request.tokenId}`,
        });

        this.requireTrustworthyPreparation(request, prepared, collection);
        return prepared;
    }

    private async requireCellCollection(): Promise<string> {
        const config = await this.appConfig.load();
        const collection = config.contracts.cell;

        if (!evmAddressSchema.safeParse(collection).success) {
            throw new MarketError({
                code: MarketErrorCode.InvalidMarketResponse,
                message:
                    'The Cell collection contract is not configured for this network, so the order a listing asks ' +
                    'the wallet to sign cannot be checked against the collection it must offer.',
                retryable: false,
                retryAfterSeconds: null,
                stage: MarketActionStage.Prepare,
                txHash: null,
            });
        }

        return collection;
    }

    private requireTrustworthyPreparation(
        request: ListCellRequest,
        prepared: PrepareListingResponse,
        collection: string,
    ): void {
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
        this.requireOfferedCell(request, prepared, collection);
        this.requireOrderShape(request, prepared);
        this.requireConsideration(request, prepared);
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
        if (listing.startTime > this.nowSeconds() + LISTING_START_TIME_SKEW_SECONDS) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it does not become fillable until ${listing.startTime}, so it would not be the listing you asked ` +
                    'for now',
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

    private requireOfferedCell(request: ListCellRequest, prepared: PrepareListingResponse, collection: string): void {
        const order = prepared.order;
        const sold = order.offer.length === 1 ? (order.offer[0] ?? null) : null;

        if (sold === null || sold.identifierOrCriteria !== request.tokenId) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign does not offer exactly Cell ${request.tokenId}`,
                request,
            );
        }
        if (sold.itemType !== SeaportItemType.Erc721) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign offers item type ${sold.itemType} rather than the ERC-721 Cell`,
                request,
            );
        }
        if (!sameAddress(sold.token, collection)) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign offers a token of collection ${sold.token} instead of the ` +
                    `Cell collection ${collection}`,
                request,
            );
        }
        if (sold.startAmount !== LISTING_SINGLE_UNIT || sold.endAmount !== LISTING_SINGLE_UNIT) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign offers ${sold.startAmount} units of the Cell rather than one`,
                request,
            );
        }
    }

    private requireOrderShape(request: ListCellRequest, prepared: PrepareListingResponse): void {
        const order = prepared.order;

        const reserved = request.buyerAddress !== null;
        const expected = reserved ? SeaportOrderType.FullRestricted : SeaportOrderType.FullOpen;

        if (order.orderType !== expected) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign is of type ${order.orderType}, while a listing ` +
                    `${reserved ? 'reserved for one buyer' : 'anyone may buy'} is of type ${expected}`,
                request,
            );
        }
        if (!reserved && (!sameAddress(order.zone, zeroAddress) || order.zoneHash !== zeroHash)) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign hands zone ${order.zone} a say over an order nothing ` +
                    'restricts',
                request,
            );
        }
        if (reserved && sameAddress(order.zone, zeroAddress)) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                'the order it asks the wallet to sign names no zone, so nothing would hold the sale to the buyer ' +
                    'you reserved it for',
                request,
            );
        }
        if (order.startTime !== prepared.listing.startTime.toString()) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign becomes fillable at ${order.startTime} instead of the ` +
                    `prepared ${prepared.listing.startTime}`,
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
    }

    private requireConsideration(request: ListCellRequest, prepared: PrepareListingResponse): void {
        const order = prepared.order;
        const currency = prepared.listing.currency.address;
        const expected = sameAddress(currency, zeroAddress) ? SeaportItemType.Native : SeaportItemType.Erc20;

        if (order.consideration.length === 0) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                'the order it asks the wallet to sign pays the seller side nothing at all',
                request,
            );
        }
        if (order.totalOriginalConsiderationItems !== order.consideration.length) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign declares ${order.totalOriginalConsiderationItems} original ` +
                    `payment items while carrying ${order.consideration.length}`,
                request,
            );
        }

        for (const item of order.consideration) {
            this.requireConsiderationItem(request, item, currency, expected);
        }

        const paid = considerationStartTotal(order);
        if (paid !== prepared.listing.price) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign collects ${paid} for the seller side rather than the gross ` +
                    `price ${prepared.listing.price}`,
                request,
            );
        }

        const kept = recipientConsiderationTotal(order, this.walletAddress());
        if (BigInt(kept) < BigInt(prepared.fees.estimatedProceeds)) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign pays this wallet ${kept} while its fee preview promises ` +
                    `${prepared.fees.estimatedProceeds}`,
                request,
            );
        }
    }

    private requireConsiderationItem(
        request: ListCellRequest,
        item: SeaportConsiderationItem,
        currency: string,
        expected: SeaportItemType,
    ): void {
        if (!sameAddress(item.token, currency)) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign pays part of the price in ${item.token} instead of the ` +
                    `listing currency ${currency}`,
                request,
            );
        }
        if (item.itemType !== expected) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign pays part of the price as item type ${item.itemType} instead ` +
                    `of ${expected}`,
                request,
            );
        }
        if (item.identifierOrCriteria !== LISTING_NO_IDENTIFIER) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign pays part of the price with token ` +
                    `${item.identifierOrCriteria} rather than a plain amount`,
                request,
            );
        }
        if (item.startAmount !== item.endAmount) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign starts a payment at ${item.startAmount} and ends it at ` +
                    `${item.endAmount}, so it could be filled for less than the price you set`,
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
