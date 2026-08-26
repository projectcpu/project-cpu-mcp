import { zeroAddress, type Abi, type Address, type Hex } from 'viem';

import {
    MarketActionTool,
    type IMarketRecoveryStore,
    type IMarketSingleFlight,
    type MarketRecoveryRecord,
} from './action.types.js';
import { narrowInvocationDeadline, waitOnInvocationBudget, waitWithinInvocationBudget } from './budget.utils.js';
import type { IMarketSingleShotClient } from './client.types.js';
import { MARKET_RETRY_BUDGET_MS, MS_PER_SECOND, PROVEN_UNPUBLISHED_MARKET_ERROR_CODES } from './constants.js';
import { MarketError } from './error.js';
import { marketActionKey } from './idempotency.utils.js';
import { MarketScanOutcome } from './listing.types.js';
import { sameAddress, seaportSignableOrder } from './listing.utils.js';
import {
    MARKET_OFFER_PREPARE_PATH,
    MARKET_OFFER_SUBMIT_PATH,
    OFFER_NO_IDENTIFIER,
    OFFER_NO_VALUE,
    OFFER_SINGLE_UNIT,
    OFFER_START_TIME_SKEW_SECONDS,
    OFFER_SUBMIT_MAX_ATTEMPTS,
} from './offer.constants.js';
import {
    prepareOfferResponseSchema,
    submitOfferResponseSchema,
    type IMarketOfferService,
    type MakeCellOfferRequest,
    type MakeCellOfferResult,
    type MarketOfferScan,
    type MarketOfferServiceOptions,
    type OfferRecoveryPayload,
    type PrepareOfferResponse,
} from './offer.types.js';
import {
    effectiveOfferDeadline,
    isEquivalentActiveOffer,
    offerActionInputs,
    orderCurrencyConsiderationTotal,
} from './offer.utils.js';
import type { IMarketProfileReader } from './profile.schemas.js';
import { MARKET_PROFILE_CACHE_MS, MARKET_RECONCILE_MAX_PAGES } from './recovery.constants.js';
import {
    cellTokenIdSchema,
    evmAddressSchema,
    MarketActionStage,
    MarketActionStatus,
    MarketErrorCode,
    MarketOfferKind,
    MarketTransactionKind,
    positiveBaseUnitAmountSchema,
    unixSecondsSchema,
    type MarketOffer,
    type MarketTransaction,
} from './types.js';
import type { CurrencyApprovalCall } from '../../contracts/approval.types.js';
import { currencyApprovalCall } from '../../contracts/approval.utils.js';
import { SeaportSpenderReader } from '../../contracts/seaport-spender.reader.js';
import {
    SEAPORT_ADDRESS,
    SEAPORT_COUNTER_ABI,
    SEAPORT_DOMAIN_NAME,
    SEAPORT_DOMAIN_VERSION,
    SEAPORT_ORDER_COMPONENTS_TYPES,
    SEAPORT_ORDER_PRIMARY_TYPE,
} from '../../contracts/seaport.constants.js';
import {
    SeaportItemType,
    SeaportOrderType,
    SeaportSpenderOutcome,
    type ISeaportSpenderReader,
} from '../../contracts/seaport.types.js';
import type { ILogger } from '../../logger/types.js';
import { errorMessage } from '../../utils/error.utils.js';
import { TxStatus, type WalletProvider } from '../../wallet/types.js';
import type { IAppConfig } from '../types.js';

const SIGNABLE_OFFER_ORDER_TYPES: ReadonlySet<number> = new Set([
    SeaportOrderType.FullOpen,
    SeaportOrderType.FullRestricted,
]);

export class MarketOfferService implements IMarketOfferService {
    private readonly client: IMarketSingleShotClient;
    private readonly profile: IMarketProfileReader;
    private readonly appConfig: IAppConfig;
    private readonly wallet: WalletProvider;
    private readonly network: string;
    private readonly singleFlight: IMarketSingleFlight;
    private readonly recovery: IMarketRecoveryStore;
    private readonly logger: ILogger;
    private readonly spenders: ISeaportSpenderReader;
    private lastProfileReadAt: number | null = null;

    constructor(options: MarketOfferServiceOptions) {
        this.spenders = new SeaportSpenderReader({ wallet: options.wallet });
        this.client = options.client;
        this.profile = options.profile;
        this.appConfig = options.appConfig;
        this.wallet = options.wallet;
        this.network = options.network;
        this.singleFlight = options.singleFlight;
        this.recovery = options.recovery;
        this.logger = options.logger;
    }

    async makeCellOffer(request: MakeCellOfferRequest): Promise<MakeCellOfferResult> {
        const validated = this.requireUsableRequest(request);
        const key = marketActionKey({
            wallet: this.walletAddress(),
            network: this.network,
            tool: MarketActionTool.MakeCellOffer,
            inputs: offerActionInputs(validated),
        });

        return this.singleFlight.run(key, async () => this.publish(key, validated));
    }

    private async publish(key: string, request: MakeCellOfferRequest): Promise<MakeCellOfferResult> {
        const unresolved = this.recovery.read<OfferRecoveryPayload>(key);
        if (unresolved !== null && unresolved.payload.prepared !== null) {
            return this.resume(key, request, unresolved);
        }

        this.reserve(key, MarketActionStage.Reconcile, this.emptyPayload());

        let payload = this.emptyPayload();
        try {
            const active = await this.findEquivalentActiveOffer(request);
            if (active !== null) {
                this.recovery.forget(key);
                return this.result(
                    MarketActionStatus.AlreadyCompleted,
                    MarketActionStage.Reconcile,
                    request,
                    payload,
                    active,
                );
            }

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
        request: MakeCellOfferRequest,
        record: MarketRecoveryRecord<OfferRecoveryPayload>,
    ): Promise<MakeCellOfferResult> {
        const payload = record.payload;
        const prepared = payload.prepared;
        if (prepared === null) {
            this.recovery.forget(key);
            return this.publish(key, request);
        }

        if (this.nowSeconds() >= effectiveOfferDeadline(prepared)) {
            return this.reconcileExpired(key, request, prepared);
        }

        if (payload.signature === null) {
            const resumed = { ...payload, approvalTxHashes: await this.broadcastApprovals(prepared) };
            const signed = { ...resumed, signature: await this.sign(prepared) };
            this.reserve(key, MarketActionStage.Sign, signed);
            return this.submit(key, request, signed, false);
        }

        return this.submit(key, request, payload, record.stage === MarketActionStage.Submit);
    }

    private async submit(
        key: string,
        request: MakeCellOfferRequest,
        payload: OfferRecoveryPayload,
        submittedBefore: boolean,
    ): Promise<MakeCellOfferResult> {
        const prepared = this.requirePrepared(payload);
        const startedAt = Date.now();
        let reachedServer = submittedBefore;

        for (let attempt = 1; attempt <= OFFER_SUBMIT_MAX_ATTEMPTS; attempt += 1) {
            this.requireWithinDeadline(prepared, MarketActionStage.Submit);
            const priorSubmission = reachedServer;
            const attemptAt = Date.now();
            reachedServer = true;

            try {
                const response = await this.client.sendOnce({
                    path: MARKET_OFFER_SUBMIT_PATH,
                    method: 'POST',
                    body: { prepareId: prepared.prepareId, signature: payload.signature },
                    schema: submitOfferResponseSchema,
                    stage: MarketActionStage.Submit,
                    label: `Publishing the offer for Cell ${request.tokenId}`,
                });

                this.recovery.forget(key);
                return this.result(
                    MarketActionStatus.Completed,
                    MarketActionStage.Submit,
                    request,
                    payload,
                    response.offer,
                );
            } catch (error) {
                if (this.provenUnpublished(error, priorSubmission)) {
                    this.recovery.forget(key);
                    throw error;
                }

                this.reserve(key, MarketActionStage.Submit, payload);
                this.logger.warn('the offer submit left an uncertain outcome — reconciling before any retry', {
                    tokenId: request.tokenId,
                    attempt,
                });

                const published = await this.reconcile(request, prepared, MarketActionStage.Submit);
                if (published !== null) {
                    this.recovery.forget(key);
                    return this.result(
                        MarketActionStatus.AlreadyCompleted,
                        MarketActionStage.Submit,
                        request,
                        payload,
                        published,
                    );
                }

                if (error instanceof MarketError && !error.retryable) {
                    throw this.outcomeUnknown(request, MarketActionStage.Submit, null);
                }

                if (attempt < OFFER_SUBMIT_MAX_ATTEMPTS) {
                    await this.holdOffResubmission(error, request, attemptAt, startedAt);
                }
            }
        }

        throw this.outcomeUnknown(request, MarketActionStage.Submit, null);
    }

    private provenUnpublished(error: unknown, priorSubmission: boolean): boolean {
        return (
            !priorSubmission &&
            error instanceof MarketError &&
            !error.retryable &&
            PROVEN_UNPUBLISHED_MARKET_ERROR_CODES.has(error.code)
        );
    }

    private async holdOffResubmission(
        error: unknown,
        request: MakeCellOfferRequest,
        attemptAt: number,
        startedAt: number,
    ): Promise<void> {
        const seconds = error instanceof MarketError ? error.retryAfterSeconds : null;
        if (seconds === null) {
            return;
        }

        const owed = seconds * MS_PER_SECOND - (Date.now() - attemptAt);
        if (owed <= 0) {
            return;
        }
        this.logger.info('waiting out the delay the marketplace asked for before repeating the submission', { owed });

        const waited = await waitWithinInvocationBudget(owed, MARKET_RETRY_BUDGET_MS - (Date.now() - startedAt));
        if (!waited) {
            throw this.outcomeUnknown(request, MarketActionStage.Submit, seconds);
        }
    }

    private async reconcileExpired(
        key: string,
        request: MakeCellOfferRequest,
        prepared: PrepareOfferResponse,
    ): Promise<MakeCellOfferResult> {
        const published = await this.reconcile(request, prepared, MarketActionStage.Reconcile);
        if (published !== null) {
            this.recovery.forget(key);
            return this.result(
                MarketActionStatus.AlreadyCompleted,
                MarketActionStage.Reconcile,
                request,
                { prepared, signature: null, approvalTxHashes: [] },
                published,
            );
        }

        this.recovery.forget(key);
        throw new MarketError({
            code: MarketErrorCode.PreparedIntentExpired,
            message:
                `The prepared offer for Cell ${request.tokenId} ran out of time before it could be published, and ` +
                'no matching offer is active. Call the tool again to prepare a fresh offer.',
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Reconcile,
            txHash: null,
        });
    }

    private async reconcile(
        request: MakeCellOfferRequest,
        prepared: PrepareOfferResponse,
        stage: MarketActionStage,
    ): Promise<MarketOffer | null> {
        await this.waitForProfileCacheHorizon();

        let scan: MarketOfferScan;
        try {
            scan = await this.scanActiveOffers(request, prepared.offer.currency.address);
        } catch (error) {
            this.logger.error('cannot reconcile an uncertain offer against the marketplace', {
                tokenId: request.tokenId,
                error,
            });
            throw this.outcomeUnknown(request, stage, null);
        }

        if (scan.outcome === MarketScanOutcome.Exhausted) {
            this.logger.error('the active offers run past the pages this tool may read, so nothing is settled', {
                tokenId: request.tokenId,
                pages: MARKET_RECONCILE_MAX_PAGES,
            });
            throw this.outcomeUnknown(request, stage, null);
        }

        return scan.offer;
    }

    private async findEquivalentActiveOffer(request: MakeCellOfferRequest): Promise<MarketOffer | null> {
        const scan = await this.scanActiveOffers(request, null);

        if (scan.outcome === MarketScanOutcome.Exhausted) {
            throw new MarketError({
                code: MarketErrorCode.OutcomeUnknown,
                message:
                    `Your active offers run past the ${MARKET_RECONCILE_MAX_PAGES} pages this tool reads, so it ` +
                    `cannot rule out that you already offer this much for Cell ${request.tokenId}, and it will not ` +
                    'prepare another offer blindly. Cancel offers you no longer need, then call the tool again.',
                retryable: true,
                retryAfterSeconds: null,
                stage: MarketActionStage.Reconcile,
                txHash: null,
            });
        }

        return scan.offer;
    }

    private async scanActiveOffers(request: MakeCellOfferRequest, currency: string | null): Promise<MarketOfferScan> {
        const wallet = this.walletAddress();
        let cursor: string | null = null;

        for (let page = 0; page < MARKET_RECONCILE_MAX_PAGES; page += 1) {
            const offers = await this.profile.getMyOffers(cursor);
            this.lastProfileReadAt = Date.now();

            const match = offers.items.find((offer) => isEquivalentActiveOffer(offer, request, wallet, currency));
            if (match !== undefined) {
                return { outcome: MarketScanOutcome.Found, offer: match };
            }

            cursor = offers.nextCursor;
            if (cursor === null) {
                return { outcome: MarketScanOutcome.Absent, offer: null };
            }
        }

        return { outcome: MarketScanOutcome.Exhausted, offer: null };
    }

    private async waitForProfileCacheHorizon(): Promise<void> {
        if (this.lastProfileReadAt === null) {
            return;
        }

        const remaining = MARKET_PROFILE_CACHE_MS - (Date.now() - this.lastProfileReadAt);
        if (remaining > 0) {
            this.logger.info('waiting for the marketplace read snapshot to advance before reconciling', { remaining });
            await waitOnInvocationBudget(remaining);
        }
    }

    private async prepare(request: MakeCellOfferRequest): Promise<PrepareOfferResponse> {
        const collection = await this.requireCellCollection();
        const counter = await this.currentCounter();

        const prepared = await this.client.send({
            path: MARKET_OFFER_PREPARE_PATH,
            method: 'POST',
            body: {
                tokenId: request.tokenId,
                amount: request.amount,
                expirationTime: request.expirationTime,
                counter,
            },
            schema: prepareOfferResponseSchema,
            stage: MarketActionStage.Prepare,
            label: `Preparing the offer for Cell ${request.tokenId}`,
        });

        await this.requireTrustworthyPreparation(request, prepared, counter, collection);
        return prepared;
    }

    private async currentCounter(): Promise<string> {
        let counter: unknown;

        try {
            counter = await this.wallet.get().readContract({
                address: SEAPORT_ADDRESS,
                abi: SEAPORT_COUNTER_ABI as unknown as Abi,
                functionName: 'getCounter',
                args: [this.walletAddress()],
            });
        } catch (error) {
            throw new MarketError({
                code: MarketErrorCode.NetworkFailure,
                message:
                    `The protocol contract ${SEAPORT_ADDRESS} did not answer this wallet's order counter, so an ` +
                    `offer cannot be prepared yet: ${errorMessage(error)}.`,
                retryable: true,
                retryAfterSeconds: null,
                stage: MarketActionStage.Prepare,
                txHash: null,
            });
        }

        if (typeof counter !== 'bigint') {
            throw new MarketError({
                code: MarketErrorCode.InvalidMarketResponse,
                message:
                    `The protocol contract ${SEAPORT_ADDRESS} answered this wallet's order counter with something ` +
                    'that is not a whole number, so no offer may be signed against it.',
                retryable: false,
                retryAfterSeconds: null,
                stage: MarketActionStage.Prepare,
                txHash: null,
            });
        }

        return counter.toString();
    }

    private async requireCellCollection(): Promise<string> {
        const config = await this.appConfig.load();
        const collection = config.contracts.cell;

        if (!evmAddressSchema.safeParse(collection).success) {
            throw new MarketError({
                code: MarketErrorCode.InvalidMarketResponse,
                message:
                    'The Cell collection contract is not configured for this network, so the order an offer asks ' +
                    'the wallet to sign cannot be checked against the collection it must ask for.',
                retryable: false,
                retryAfterSeconds: null,
                stage: MarketActionStage.Prepare,
                txHash: null,
            });
        }

        return collection;
    }

    private async requireTrustworthyPreparation(
        request: MakeCellOfferRequest,
        prepared: PrepareOfferResponse,
        counter: string,
        collection: string,
    ): Promise<void> {
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
        if (!sameAddress(prepared.offer.maker, wallet) || !sameAddress(prepared.order.offerer, wallet)) {
            throw this.untrustworthy(
                MarketErrorCode.WrongOwner,
                `it bids on behalf of ${prepared.offer.maker} rather than this wallet ${wallet}`,
                request,
            );
        }

        this.requireRequestedTerms(request, prepared, counter);
        this.requireSpendableCurrency(request, prepared);
        await this.requireCurrencyApprovalsOnly(request, prepared);
        this.requireOfferedAmount(request, prepared);
        this.requireRequestedCell(request, prepared, collection);
        this.requireOrderShape(request, prepared);
    }

    private requireRequestedTerms(
        request: MakeCellOfferRequest,
        prepared: PrepareOfferResponse,
        counter: string,
    ): void {
        const offer = prepared.offer;

        if (offer.kind !== MarketOfferKind.Item) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it is a "${offer.kind}" offer, while this tool only ever makes an item offer for one exact Cell`,
                request,
            );
        }
        if (offer.tokenId !== request.tokenId) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it bids on Cell ${offer.tokenId} instead of Cell ${request.tokenId}`,
                request,
            );
        }
        if (offer.amount !== request.amount) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it bids ${offer.amount} instead of the requested ${request.amount}`,
                request,
            );
        }
        if (offer.expirationTime !== request.expirationTime) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it expires at ${offer.expirationTime} instead of the requested ${request.expirationTime}`,
                request,
            );
        }
        if (offer.counter !== counter) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it carries order counter ${offer.counter} while this wallet's current counter is ${counter}`,
                request,
            );
        }
        if (offer.startTime > this.nowSeconds() + OFFER_START_TIME_SKEW_SECONDS) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it cannot be accepted until ${offer.startTime}, so it would not be the offer you asked for now`,
                request,
            );
        }
    }

    private requireSpendableCurrency(request: MakeCellOfferRequest, prepared: PrepareOfferResponse): void {
        if (sameAddress(prepared.offer.currency.address, zeroAddress)) {
            throw new MarketError({
                code: MarketErrorCode.CurrencyUnsupported,
                message:
                    `The prepared offer for Cell ${request.tokenId} is priced in the chain's own currency, which ` +
                    'cannot be escrowed by an off-chain offer. An offer must be made in a token the marketplace ' +
                    'can pull when a seller accepts it.',
                retryable: false,
                retryAfterSeconds: null,
                stage: MarketActionStage.Prepare,
                txHash: null,
            });
        }
    }

    private async requireCurrencyApprovalsOnly(
        request: MakeCellOfferRequest,
        prepared: PrepareOfferResponse,
    ): Promise<void> {
        const chainId = this.wallet.get().getChainId();
        const currency = prepared.offer.currency.address;
        const approvals: Array<CurrencyApprovalCall> = [];

        for (const transaction of prepared.transactions) {
            if (transaction.kind !== MarketTransactionKind.CurrencyApproval || transaction.chainId !== chainId) {
                throw this.untrustworthy(
                    MarketErrorCode.InvalidMarketResponse,
                    `publishing an offer may only need currency approvals, but it asks to send a ` +
                        `"${transaction.kind}" transaction on chain ${transaction.chainId}`,
                    request,
                );
            }
            if (!sameAddress(transaction.to, currency)) {
                throw this.untrustworthy(
                    MarketErrorCode.InvalidMarketResponse,
                    `it asks the wallet to approve ${transaction.to} instead of the offer currency ${currency}`,
                    request,
                );
            }
            if (transaction.value !== OFFER_NO_VALUE) {
                throw this.untrustworthy(
                    MarketErrorCode.InvalidMarketResponse,
                    `its currency approval would also send ${transaction.value} of the chain currency away`,
                    request,
                );
            }

            approvals.push(this.requireExactApprovalAmount(request, transaction));
        }

        await this.requireOrderSpender(request, prepared, approvals);
    }

    private requireExactApprovalAmount(
        request: MakeCellOfferRequest,
        transaction: MarketTransaction,
    ): CurrencyApprovalCall {
        const approval = currencyApprovalCall(transaction.data);

        if (approval === null) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                'it asks the wallet to send calldata the offer currency would not read as an approval of a single ' +
                    'exact amount',
                request,
            );
        }
        if (approval.amount !== BigInt(request.amount)) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it asks the wallet to approve ${approval.amount.toString()} of the offer currency rather than ` +
                    `exactly the ${request.amount} this offer bids`,
                request,
            );
        }

        return approval;
    }

    private async requireOrderSpender(
        request: MakeCellOfferRequest,
        prepared: PrepareOfferResponse,
        approvals: ReadonlyArray<CurrencyApprovalCall>,
    ): Promise<void> {
        if (approvals.length === 0) {
            return;
        }

        const conduitKey = prepared.order.conduitKey;
        const answer = await this.spenders.spenderForConduitKey(conduitKey);
        const detail = answer.detail ?? `conduit key ${conduitKey} resolves to nothing`;

        if (answer.outcome === SeaportSpenderOutcome.Unreachable) {
            throw new MarketError({
                code: MarketErrorCode.NetworkFailure,
                message:
                    `The offer for Cell ${request.tokenId} was not signed because ${detail}. Nothing was approved ` +
                    'and nothing was published.',
                retryable: true,
                retryAfterSeconds: null,
                stage: MarketActionStage.Prepare,
                txHash: null,
            });
        }
        if (answer.address === null) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign settles through a spender this client cannot justify: ` +
                    `${detail}`,
                request,
            );
        }

        const spender = answer.address;
        const foreign = approvals.find((approval) => !sameAddress(approval.spender, spender));
        if (foreign !== undefined) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it asks the wallet to let ${foreign.spender} spend the offer currency, while the order it signs ` +
                    `is settled by ${spender}`,
                request,
            );
        }
    }

    private requireOfferedAmount(request: MakeCellOfferRequest, prepared: PrepareOfferResponse): void {
        const order = prepared.order;
        const currency = prepared.offer.currency.address;
        const paid = order.offer.length === 1 ? (order.offer[0] ?? null) : null;

        if (paid === null) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign puts up ${order.offer.length} items rather than one amount of ` +
                    'the offer currency',
                request,
            );
        }
        if (paid.itemType !== SeaportItemType.Erc20 || !sameAddress(paid.token, currency)) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign puts up item type ${paid.itemType} of token ${paid.token} ` +
                    `instead of the offer currency ${currency}`,
                request,
            );
        }
        if (paid.identifierOrCriteria !== OFFER_NO_IDENTIFIER) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign puts up token ${paid.identifierOrCriteria} rather than a ` +
                    'plain amount',
                request,
            );
        }
        if (paid.startAmount !== request.amount || paid.endAmount !== request.amount) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign puts up ${paid.startAmount} rising to ${paid.endAmount} ` +
                    `instead of exactly the ${request.amount} you offered`,
                request,
            );
        }
    }

    private requireRequestedCell(
        request: MakeCellOfferRequest,
        prepared: PrepareOfferResponse,
        collection: string,
    ): void {
        const order = prepared.order;
        const wallet = this.walletAddress();
        const wanted = order.consideration.filter((item) => item.itemType !== SeaportItemType.Erc20);

        if (wanted.length !== 1) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign asks for ${wanted.length} non-currency items rather than the ` +
                    `one Cell ${request.tokenId}`,
                request,
            );
        }

        const cell = wanted[0];
        if (cell === undefined || cell.itemType !== SeaportItemType.Erc721) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign asks for item type ${cell?.itemType} rather than one exact ` +
                    'ERC-721 Cell, so it would not be an item offer',
                request,
            );
        }
        if (!sameAddress(cell.token, collection)) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign asks for a token of collection ${cell.token} instead of the ` +
                    `Cell collection ${collection}`,
                request,
            );
        }
        if (cell.identifierOrCriteria !== request.tokenId) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign asks for Cell ${cell.identifierOrCriteria} instead of Cell ` +
                    `${request.tokenId}`,
                request,
            );
        }
        if (cell.startAmount !== OFFER_SINGLE_UNIT || cell.endAmount !== OFFER_SINGLE_UNIT) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign asks for ${cell.startAmount} units of the Cell rather than one`,
                request,
            );
        }
        if (!sameAddress(cell.recipient, wallet)) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign sends the Cell to ${cell.recipient} rather than to this ` +
                    `wallet ${wallet}`,
                request,
            );
        }
    }

    private requireOrderShape(request: MakeCellOfferRequest, prepared: PrepareOfferResponse): void {
        const order = prepared.order;
        const currency = prepared.offer.currency.address;

        if (!SIGNABLE_OFFER_ORDER_TYPES.has(order.orderType)) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign is of type ${order.orderType}, which could be filled in parts ` +
                    'or by a contract rather than as the whole offer you made',
                request,
            );
        }
        if (order.totalOriginalConsiderationItems !== order.consideration.length) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign declares ${order.totalOriginalConsiderationItems} original ` +
                    `items while carrying ${order.consideration.length}`,
                request,
            );
        }
        if (order.counter !== prepared.offer.counter) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign carries counter ${order.counter} while the prepared offer ` +
                    `carries ${prepared.offer.counter}`,
                request,
            );
        }
        if (order.startTime !== prepared.offer.startTime.toString()) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign becomes acceptable at ${order.startTime} instead of the ` +
                    `prepared ${prepared.offer.startTime}`,
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

        for (const item of order.consideration) {
            if (item.itemType === SeaportItemType.Erc20 && !sameAddress(item.token, currency)) {
                throw this.untrustworthy(
                    MarketErrorCode.InvalidMarketResponse,
                    `the order it asks the wallet to sign pays part of the offer in ${item.token} instead of the ` +
                        `offer currency ${currency}`,
                    request,
                );
            }
            if (item.itemType === SeaportItemType.Erc20 && item.startAmount !== item.endAmount) {
                throw this.untrustworthy(
                    MarketErrorCode.InvalidMarketResponse,
                    `the order it asks the wallet to sign starts a payment at ${item.startAmount} and ends it at ` +
                        `${item.endAmount}, so it could cost more than the amount you offered`,
                    request,
                );
            }
        }

        const charged = orderCurrencyConsiderationTotal(order, currency);
        if (BigInt(charged) > BigInt(request.amount)) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `the order it asks the wallet to sign pays out ${charged} of the currency while you only offered ` +
                    `${request.amount}`,
                request,
            );
        }
    }

    private async broadcastApprovals(prepared: PrepareOfferResponse): Promise<Array<string>> {
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
                    'The currency approval this offer needs reverted on-chain, so the offer was never signed or ' +
                    'published.',
                retryable: false,
                retryAfterSeconds: null,
                stage: MarketActionStage.Approve,
                txHash: hash,
            });
        }

        return hash;
    }

    private async sign(prepared: PrepareOfferResponse): Promise<string> {
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

    private requireWithinDeadline(prepared: PrepareOfferResponse, stage: MarketActionStage): void {
        const deadline = effectiveOfferDeadline(prepared);
        narrowInvocationDeadline(deadline);

        if (this.nowSeconds() < deadline) {
            return;
        }

        throw new MarketError({
            code: MarketErrorCode.PreparedIntentExpired,
            message:
                'This prepared offer is past the earlier of its own deadline and the offer expiry, so it can no ' +
                'longer be signed or published. Call the tool again to prepare a fresh offer.',
            retryable: false,
            retryAfterSeconds: null,
            stage,
            txHash: null,
        });
    }

    private requirePrepared(payload: OfferRecoveryPayload): PrepareOfferResponse {
        if (payload.prepared === null) {
            throw new MarketError({
                code: MarketErrorCode.InvalidMarketResponse,
                message: 'The offer has no prepared order to publish.',
                retryable: false,
                retryAfterSeconds: null,
                stage: MarketActionStage.Submit,
                txHash: null,
            });
        }

        return payload.prepared;
    }

    private requireUsableRequest(request: MakeCellOfferRequest): MakeCellOfferRequest {
        const tokenId = cellTokenIdSchema.safeParse(request.tokenId);
        if (!tokenId.success) {
            throw this.rejectedInput(
                `"${request.tokenId}" is not a canonical Cell token id. Pass a decimal integer with no leading ` +
                    'zeroes so that one Cell keeps one identity.',
            );
        }

        const amount = positiveBaseUnitAmountSchema.safeParse(request.amount);
        if (!amount.success) {
            throw this.rejectedInput(
                `"${request.amount}" is not an offer amount. Pass what you bid as a positive decimal integer of the ` +
                    'currency base units, never a decimal fraction.',
            );
        }

        const expirationTime = unixSecondsSchema.safeParse(request.expirationTime);
        if (!expirationTime.success || expirationTime.data <= this.nowSeconds()) {
            throw this.rejectedInput(
                `${request.expirationTime} is not a future expiry. Pass the Unix second at which the offer should ` +
                    'stop being acceptable.',
            );
        }

        return { tokenId: tokenId.data, amount: amount.data, expirationTime: expirationTime.data };
    }

    private reserve(key: string, stage: MarketActionStage, payload: OfferRecoveryPayload): void {
        this.recovery.write(key, { tool: MarketActionTool.MakeCellOffer, stage, payload });
    }

    private emptyPayload(): OfferRecoveryPayload {
        return { prepared: null, signature: null, approvalTxHashes: [] };
    }

    private result(
        status: MarketActionStatus,
        stage: MarketActionStage,
        request: MakeCellOfferRequest,
        payload: OfferRecoveryPayload,
        offer: MarketOffer,
    ): MakeCellOfferResult {
        this.logger.info('the Cell offer is published', {
            tokenId: request.tokenId,
            status,
            orderHash: offer.orderHash,
        });

        return {
            status,
            stage,
            wallet: this.walletAddress(),
            tokenId: request.tokenId,
            offer,
            amount: offer.amount,
            currency: offer.currency,
            approvalTxHashes: [...payload.approvalTxHashes],
        };
    }

    private outcomeUnknown(
        request: MakeCellOfferRequest,
        stage: MarketActionStage,
        retryAfterSeconds: number | null,
    ): MarketError {
        return new MarketError({
            code: MarketErrorCode.OutcomeUnknown,
            message:
                `The offer for Cell ${request.tokenId} was submitted but its outcome could not be confirmed, and ` +
                'the marketplace cannot be read to settle the question. The exact prepared order is kept, so ' +
                'repeating this call republishes the same order rather than creating a second one.',
            retryable: true,
            retryAfterSeconds,
            stage,
            txHash: null,
        });
    }

    private untrustworthy(code: MarketErrorCode, detail: string, request: MakeCellOfferRequest): MarketError {
        this.logger.error('the prepared offer does not match the request', { tokenId: request.tokenId, detail });

        return new MarketError({
            code,
            message: `The prepared offer for Cell ${request.tokenId} cannot be signed: ${detail}.`,
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
