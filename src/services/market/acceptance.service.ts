import type { Address, Hex } from 'viem';

import {
    ACCEPTANCE_EMPTY_CALLDATA,
    ACCEPTANCE_NO_VALUE,
    ACCEPTANCE_START_TIME_SKEW_SECONDS,
    MARKET_ACCEPTANCE_PREPARE_PATH,
} from './acceptance.constants.js';
import {
    prepareAcceptanceResponseSchema,
    type AcceptCellOfferRequest,
    type AcceptCellOfferResult,
    type AcceptanceRecoveryPayload,
    type IMarketAcceptanceService,
    type MarketAcceptanceServiceOptions,
    type PrepareAcceptanceResponse,
} from './acceptance.types.js';
import {
    acceptanceActionInputs,
    acceptanceApprovals,
    acceptanceFulfilment,
    effectiveAcceptanceDeadline,
} from './acceptance.utils.js';
import {
    MarketActionTool,
    type IMarketRecoveryStore,
    type IMarketSingleFlight,
    type MarketRecoveryRecord,
} from './action.types.js';
import type { IMarketSingleShotClient } from './client.types.js';
import { MS_PER_SECOND } from './constants.js';
import { MarketError } from './error.js';
import type { IMarketFulfilmentProof } from './fulfilment-proof.types.js';
import { marketActionKey } from './idempotency.utils.js';
import { sameAddress } from './listing.utils.js';
import { sameOrderHash } from './purchase.utils.js';
import {
    cellTokenIdSchema,
    evmAddressSchema,
    MarketActionStage,
    MarketActionStatus,
    MarketErrorCode,
    MarketOfferKind,
    MarketTransactionKind,
    orderHashSchema,
    type MarketTransaction,
} from './types.js';
import type { CollectionApprovalCall } from '../../contracts/approval.types.js';
import { collectionApprovalCall } from '../../contracts/approval.utils.js';
import { CELL_ABI } from '../../contracts/cell.abi.js';
import { SeaportSpenderReader } from '../../contracts/seaport-spender.reader.js';
import { SEAPORT_ADDRESS } from '../../contracts/seaport.constants.js';
import { SeaportSpenderOutcome, type ISeaportSpenderReader } from '../../contracts/seaport.types.js';
import type { ILogger } from '../../logger/types.js';
import { errorMessage } from '../../utils/error.utils.js';
import { TxStatus, type TxReceipt, type WalletProvider } from '../../wallet/types.js';
import type { IAppConfig } from '../types.js';

export class MarketAcceptanceService implements IMarketAcceptanceService {
    private readonly client: IMarketSingleShotClient;
    private readonly proof: IMarketFulfilmentProof;
    private readonly appConfig: IAppConfig;
    private readonly wallet: WalletProvider;
    private readonly network: string;
    private readonly singleFlight: IMarketSingleFlight;
    private readonly recovery: IMarketRecoveryStore;
    private readonly logger: ILogger;
    private readonly spenders: ISeaportSpenderReader;

    constructor(options: MarketAcceptanceServiceOptions) {
        this.spenders = new SeaportSpenderReader({ wallet: options.wallet });
        this.client = options.client;
        this.proof = options.proof;
        this.appConfig = options.appConfig;
        this.wallet = options.wallet;
        this.network = options.network;
        this.singleFlight = options.singleFlight;
        this.recovery = options.recovery;
        this.logger = options.logger;
    }

    async acceptCellOffer(request: AcceptCellOfferRequest): Promise<AcceptCellOfferResult> {
        const validated = this.requireUsableRequest(request);
        const key = marketActionKey({
            wallet: this.walletAddress(),
            network: this.network,
            tool: MarketActionTool.AcceptCellOffer,
            inputs: acceptanceActionInputs(validated),
        });

        return this.singleFlight.run(key, async () => this.accept(key, validated));
    }

    private async accept(key: string, request: AcceptCellOfferRequest): Promise<AcceptCellOfferResult> {
        const unresolved = this.recovery.read<AcceptanceRecoveryPayload>(key);
        if (unresolved !== null && unresolved.payload.fulfilmentTxHash !== null) {
            return this.settleKnownFulfilment(key, request, unresolved);
        }

        this.reserve(key, MarketActionStage.Prepare, this.emptyPayload());

        let prepared: PrepareAcceptanceResponse;
        try {
            prepared = await this.prepare(request);
        } catch (error) {
            this.recovery.forget(key);
            throw error;
        }

        let payload: AcceptanceRecoveryPayload = { prepared, approvalTxHashes: [], fulfilmentTxHash: null };
        this.reserve(key, MarketActionStage.Prepare, payload);

        for (const approval of acceptanceApprovals(prepared)) {
            let hash: string;
            try {
                hash = await this.broadcastApproval(approval, request);
            } catch (error) {
                this.recovery.forget(key);
                throw error;
            }

            payload = { ...payload, approvalTxHashes: [...payload.approvalTxHashes, hash] };
            this.reserve(key, MarketActionStage.Approve, payload);
        }

        return this.fulfil(key, request, payload);
    }

    private async fulfil(
        key: string,
        request: AcceptCellOfferRequest,
        payload: AcceptanceRecoveryPayload,
    ): Promise<AcceptCellOfferResult> {
        let transaction: MarketTransaction;
        try {
            const prepared = this.requirePrepared(payload);
            this.requireWithinDeadline(prepared, MarketActionStage.Fulfil);
            transaction = this.requireFulfilmentTransaction(prepared, request);
        } catch (error) {
            this.recovery.forget(key);
            throw error;
        }

        let hash: string;
        try {
            hash = await this.send(transaction);
        } catch (error) {
            this.reserve(key, MarketActionStage.Fulfil, payload);
            throw this.lostBroadcast(request, payload, errorMessage(error));
        }

        const sent: AcceptanceRecoveryPayload = { ...payload, fulfilmentTxHash: hash };
        this.reserve(key, MarketActionStage.Fulfil, sent);

        return this.settle(key, request, sent, MarketActionStatus.Completed);
    }

    private async settleKnownFulfilment(
        key: string,
        request: AcceptCellOfferRequest,
        record: MarketRecoveryRecord<AcceptanceRecoveryPayload>,
    ): Promise<AcceptCellOfferResult> {
        this.logger.info(
            'an acceptance of this exact offer is already on-chain — proving it instead of selling again',
            {
                orderHash: request.orderHash,
                txHash: record.payload.fulfilmentTxHash,
            },
        );

        return this.settle(key, request, record.payload, MarketActionStatus.AlreadyCompleted);
    }

    private async settle(
        key: string,
        request: AcceptCellOfferRequest,
        payload: AcceptanceRecoveryPayload,
        status: MarketActionStatus,
    ): Promise<AcceptCellOfferResult> {
        const hash = this.requireFulfilmentHash(payload);
        const receipt = await this.confirm(key, request, payload, hash);

        try {
            const collection = await this.requireCellCollection(MarketActionStage.Verify);
            await this.proof.requireFulfilment({
                receipt,
                orderHash: request.orderHash,
                wallet: this.walletAddress(),
                stage: MarketActionStage.Verify,
                boundCell: { collection, tokenId: this.requirePrepared(payload).tokenId },
            });
            await this.requireSoldCell(this.requirePrepared(payload), hash);
        } catch (error) {
            this.forgetIfSettled(key, error);
            throw error;
        }

        this.recovery.forget(key);
        return this.result(status, request, payload, hash);
    }

    // A terminal proof failure is the end of this intent: the transaction is mined and will never
    // prove anything else, so holding its record would strand one of the bounded slots for the life
    // of the process. A retryable one keeps its record, because repeating re-checks that same
    // transaction instead of sending another.
    private forgetIfSettled(key: string, error: unknown): void {
        if (error instanceof MarketError && !error.retryable) {
            this.recovery.forget(key);
        }
    }

    private async confirm(
        key: string,
        request: AcceptCellOfferRequest,
        payload: AcceptanceRecoveryPayload,
        hash: string,
    ): Promise<TxReceipt> {
        let receipt: TxReceipt;
        try {
            receipt = await this.wallet.get().waitForReceipt(hash as `0x${string}`);
        } catch (error) {
            throw new MarketError({
                code: MarketErrorCode.OutcomeUnknown,
                message:
                    `The acceptance of offer ${request.orderHash} was broadcast as ${hash}, but its receipt could ` +
                    `not be read: ${errorMessage(error)}. The transaction is kept, so repeating this call ` +
                    're-checks that exact transaction instead of selling anything else.',
                retryable: true,
                retryAfterSeconds: null,
                stage: MarketActionStage.Fulfil,
                txHash: hash,
            });
        }

        if (receipt.status === TxStatus.Success) {
            return receipt;
        }

        this.recovery.forget(key);
        throw new MarketError({
            code: MarketErrorCode.TransactionReverted,
            message:
                `The acceptance of offer ${request.orderHash} reverted on-chain, so no Cell changed hands and ` +
                `nothing was earned beyond the gas it cost. ${this.knownHashes(payload, hash)} The offer may have ` +
                'been filled or cancelled meanwhile; read the market again and pick an exact offer.',
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Fulfil,
            txHash: hash,
        });
    }

    private async requireSoldCell(prepared: PrepareAcceptanceResponse, hash: string): Promise<void> {
        const tokenId = prepared.tokenId;
        let owner: string;

        try {
            owner = await this.readCellOwner(tokenId, MarketActionStage.Verify);
        } catch (error) {
            throw new MarketError({
                code: MarketErrorCode.OutcomeUnknown,
                message:
                    `Offer ${prepared.offer.orderHash} was fulfilled by transaction ${hash}, but who owns Cell ` +
                    `${tokenId} now could not be read: ${errorMessage(error)}. The transaction is kept, so ` +
                    'repeating this call re-checks it instead of selling anything else.',
                retryable: true,
                retryAfterSeconds: null,
                stage: MarketActionStage.Verify,
                txHash: hash,
            });
        }

        if (!sameAddress(owner, this.walletAddress())) {
            return;
        }

        throw new MarketError({
            code: MarketErrorCode.WrongOwner,
            message:
                `Transaction ${hash} carries the fulfilment of offer ${prepared.offer.orderHash}, but Cell ` +
                `${tokenId} is still owned by this wallet ${this.walletAddress()}, so that transaction does not ` +
                'prove the Cell was sold. Nothing else was sent.',
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Verify,
            txHash: hash,
        });
    }

    private async prepare(request: AcceptCellOfferRequest): Promise<PrepareAcceptanceResponse> {
        const collection = await this.requireCellCollection(MarketActionStage.Prepare);
        const body: Record<string, unknown> = { orderHash: request.orderHash };
        if (request.tokenId !== null) {
            body.tokenId = request.tokenId;
        }

        const prepared = await this.client.sendOnce({
            path: MARKET_ACCEPTANCE_PREPARE_PATH,
            method: 'POST',
            body,
            schema: prepareAcceptanceResponseSchema,
            stage: MarketActionStage.Prepare,
            label: `Preparing the acceptance of offer ${request.orderHash}`,
        });

        await this.requireTrustworthyPreparation(request, prepared, collection);
        return prepared;
    }

    private async requireTrustworthyPreparation(
        request: AcceptCellOfferRequest,
        prepared: PrepareAcceptanceResponse,
        collection: string,
    ): Promise<void> {
        const wallet = this.walletAddress();
        const chainId = this.wallet.get().getChainId();

        if (prepared.chainId !== chainId || prepared.offer.chainId !== chainId) {
            throw this.untrustworthy(
                MarketErrorCode.ChainMismatch,
                `it targets chain ${prepared.chainId} while this wallet sells on chain ${chainId}`,
                request,
            );
        }
        if (
            !sameAddress(prepared.protocolAddress, SEAPORT_ADDRESS) ||
            !sameAddress(prepared.offer.protocolAddress, SEAPORT_ADDRESS)
        ) {
            throw this.untrustworthy(
                MarketErrorCode.ProtocolAddressMismatch,
                `it names protocol contract ${prepared.protocolAddress} instead of the pinned ${SEAPORT_ADDRESS}`,
                request,
            );
        }

        this.requirePinnedOffer(request, prepared);
        this.requireWithinDeadline(prepared, MarketActionStage.Prepare);
        this.requireBoundCell(request, prepared);

        if (sameAddress(prepared.offer.maker, wallet)) {
            throw this.untrustworthy(
                MarketErrorCode.WrongOwner,
                `it is your own offer — this wallet ${wallet} is both the buyer and the seller`,
                request,
            );
        }

        await this.requireOwnedCell(request, prepared);
        this.requireFulfilmentShape(request, prepared);
        await this.requireCollectionApprovals(request, prepared, collection);
    }

    private requirePinnedOffer(request: AcceptCellOfferRequest, prepared: PrepareAcceptanceResponse): void {
        const offer = prepared.offer;

        if (!sameOrderHash(offer.orderHash, request.orderHash)) {
            throw this.unavailable(
                request,
                `the marketplace answered with offer ${offer.orderHash} instead of the offer you pinned`,
            );
        }

        const now = this.nowSeconds();
        if (offer.expirationTime <= now) {
            throw this.unavailable(request, `it expired at ${offer.expirationTime} and can no longer be accepted`);
        }
        if (offer.startTime > now + ACCEPTANCE_START_TIME_SKEW_SECONDS) {
            throw this.unavailable(request, `it cannot be accepted until ${offer.startTime}`);
        }
    }

    private requireBoundCell(request: AcceptCellOfferRequest, prepared: PrepareAcceptanceResponse): void {
        const offer = prepared.offer;
        const selected = offer.kind === MarketOfferKind.Item ? this.itemCell(request, prepared) : request.tokenId;

        if (selected === null) {
            throw this.rejectedInput(
                `Offer ${request.orderHash} is a ${offer.kind} offer: it names a set of Cells rather than one, so ` +
                    'it cannot pick which of your Cells to sell. Pass the exact `tokenId` you want to sell and ' +
                    'call the tool again. Nothing was sent.',
            );
        }
        if (prepared.tokenId !== selected) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it would sell Cell ${prepared.tokenId} rather than the Cell ${selected} this call is bound to`,
                request,
            );
        }
    }

    private itemCell(request: AcceptCellOfferRequest, prepared: PrepareAcceptanceResponse): string {
        const named = prepared.offer.tokenId;

        if (named === null) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                'it calls the order an offer for one exact Cell while naming no Cell at all',
                request,
            );
        }
        if (request.tokenId !== null && request.tokenId !== named) {
            throw this.rejectedInput(
                `Offer ${request.orderHash} bids for Cell ${named}, not for the Cell ${request.tokenId} you named. ` +
                    'Accept it for that Cell, or pick another offer. Nothing was sent.',
            );
        }

        return named;
    }

    private async requireOwnedCell(
        request: AcceptCellOfferRequest,
        prepared: PrepareAcceptanceResponse,
    ): Promise<void> {
        const tokenId = prepared.tokenId;
        let owner: string;

        try {
            owner = await this.readCellOwner(tokenId, MarketActionStage.Prepare);
        } catch (error) {
            throw new MarketError({
                code: MarketErrorCode.NetworkFailure,
                message:
                    `Offer ${request.orderHash} was not accepted because who owns Cell ${tokenId} could not be ` +
                    `read: ${errorMessage(error)}. Nothing was approved and no Cell was sold.`,
                retryable: true,
                retryAfterSeconds: null,
                stage: MarketActionStage.Prepare,
                txHash: null,
            });
        }

        if (sameAddress(owner, this.walletAddress())) {
            return;
        }

        throw new MarketError({
            code: MarketErrorCode.WrongOwner,
            message:
                `Cell ${tokenId} is owned by ${owner} rather than this wallet ${this.walletAddress()}, so this ` +
                `wallet cannot sell it against offer ${request.orderHash}. Nothing was approved and nothing was ` +
                'sent. If you already sold it, that sale stands and this call would only have spent gas.',
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Prepare,
            txHash: null,
        });
    }

    private requireFulfilmentShape(request: AcceptCellOfferRequest, prepared: PrepareAcceptanceResponse): void {
        const chainId = this.wallet.get().getChainId();
        const transactions = prepared.transactions;
        const last = transactions.at(-1) ?? null;

        if (last === null || last.kind !== MarketTransactionKind.Fulfilment) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                'it does not end with the one fulfilment transaction that sells the Cell',
                request,
            );
        }
        if (acceptanceFulfilment(prepared) === null) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                'it asks to send more than one fulfilment transaction for a single offer',
                request,
            );
        }
        if (last.data === ACCEPTANCE_EMPTY_CALLDATA) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                'its fulfilment transaction carries no calldata, so it would sell nothing',
                request,
            );
        }
        if (!sameAddress(last.to, SEAPORT_ADDRESS)) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `its fulfilment transaction would hand the Cell to ${last.to} rather than to the pinned protocol ` +
                    `contract ${SEAPORT_ADDRESS}`,
                request,
            );
        }

        const foreignChain = transactions.find((transaction) => transaction.chainId !== chainId);
        if (foreignChain !== undefined) {
            throw this.untrustworthy(
                MarketErrorCode.ChainMismatch,
                `it asks to send a "${foreignChain.kind}" transaction on chain ${foreignChain.chainId} while this ` +
                    `wallet sells on chain ${chainId}`,
                request,
            );
        }

        const foreignKind = transactions
            .slice(0, -1)
            .find((transaction) => transaction.kind !== MarketTransactionKind.CollectionApproval);
        if (foreignKind !== undefined) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                'accepting an offer may only need collection approvals before the fulfilment, but it asks to send ' +
                    `a "${foreignKind.kind}" transaction first`,
                request,
            );
        }

        const valued = transactions.find((transaction) => transaction.value !== ACCEPTANCE_NO_VALUE);
        if (valued !== undefined) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it asks to send ${valued.value} native base units out of this wallet for a sale that pays it ` +
                    `${prepared.offer.amount} ${prepared.offer.currency.symbol}`,
                request,
            );
        }
    }

    private async requireCollectionApprovals(
        request: AcceptCellOfferRequest,
        prepared: PrepareAcceptanceResponse,
        collection: string,
    ): Promise<void> {
        const approvals = acceptanceApprovals(prepared).map((transaction) =>
            this.requireCollectionOperator(request, transaction, collection),
        );

        if (approvals.length === 0) {
            return;
        }

        const operator = await this.requireSettlingOperator(request, prepared);
        const stranger = approvals.find((approval) => !sameAddress(approval.operator, operator));
        if (stranger !== undefined) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it asks the wallet to let ${stranger.operator} move every Cell it owns, while this acceptance ` +
                    `settles through ${operator}`,
                request,
            );
        }
    }

    private requireCollectionOperator(
        request: AcceptCellOfferRequest,
        transaction: MarketTransaction,
        collection: string,
    ): CollectionApprovalCall {
        if (!sameAddress(transaction.to, collection)) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it asks the wallet to approve contract ${transaction.to} instead of the Cell collection ` +
                    `${collection}`,
                request,
            );
        }

        const approval = collectionApprovalCall(transaction.data);
        if (approval === null) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                'it asks the wallet to send calldata the Cell collection would not read as approving one operator',
                request,
            );
        }
        if (!approval.approved) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it asks the wallet to withdraw ${approval.operator}'s approval rather than grant the one this ` +
                    'sale needs',
                request,
            );
        }

        return approval;
    }

    private async requireSettlingOperator(
        request: AcceptCellOfferRequest,
        prepared: PrepareAcceptanceResponse,
    ): Promise<string> {
        const conduitKey = prepared.conduitKey;
        const answer = await this.spenders.spenderForConduitKey(conduitKey);
        const detail = answer.detail ?? `conduit key ${conduitKey} resolves to nothing`;

        if (answer.outcome === SeaportSpenderOutcome.Unreachable) {
            throw new MarketError({
                code: MarketErrorCode.NetworkFailure,
                message:
                    `Offer ${request.orderHash} was not accepted because ${detail}. Nothing was approved and no ` +
                    'Cell was sold.',
                retryable: true,
                retryAfterSeconds: null,
                stage: MarketActionStage.Prepare,
                txHash: null,
            });
        }
        if (answer.outcome !== SeaportSpenderOutcome.Resolved || answer.address === null) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it would settle this sale through an operator this client cannot justify: ${detail}`,
                request,
            );
        }

        return answer.address;
    }

    private async broadcastApproval(transaction: MarketTransaction, request: AcceptCellOfferRequest): Promise<string> {
        const hash = await this.send(transaction);
        const receipt = await this.wallet.get().waitForReceipt(hash as `0x${string}`);

        if (receipt.status !== TxStatus.Success) {
            throw new MarketError({
                code: MarketErrorCode.TransactionReverted,
                message:
                    'The collection approval this sale needs reverted on-chain, so offer ' +
                    `${request.orderHash} was never fulfilled and no Cell changed hands.`,
                retryable: false,
                retryAfterSeconds: null,
                stage: MarketActionStage.Approve,
                txHash: hash,
            });
        }

        return hash;
    }

    private async send(transaction: MarketTransaction): Promise<string> {
        return this.wallet.get().sendTransaction({
            to: transaction.to as Address,
            data: transaction.data as Hex,
            value: BigInt(transaction.value),
            gas: null,
        });
    }

    private async readCellOwner(tokenId: string, stage: MarketActionStage): Promise<string> {
        const collection = await this.requireCellCollection(stage);
        const cell = (await this.wallet.get().readContract({
            address: collection as Address,
            abi: CELL_ABI,
            functionName: 'getCell',
            args: [BigInt(tokenId)],
        })) as { owner: string };

        return cell.owner;
    }

    private async requireCellCollection(stage: MarketActionStage): Promise<string> {
        const config = await this.appConfig.load();
        const collection = config.contracts.cell;

        if (!evmAddressSchema.safeParse(collection).success) {
            throw new MarketError({
                code: MarketErrorCode.InvalidMarketResponse,
                message:
                    'The Cell collection contract is not configured for this network, so neither the approval this ' +
                    'sale asks for nor who owns the Cell afterwards can be checked.',
                retryable: false,
                retryAfterSeconds: null,
                stage,
                txHash: null,
            });
        }

        return collection;
    }

    private requireFulfilmentTransaction(
        prepared: PrepareAcceptanceResponse,
        request: AcceptCellOfferRequest,
    ): MarketTransaction {
        const fulfilment = acceptanceFulfilment(prepared);
        if (fulfilment !== null) {
            return fulfilment;
        }

        throw this.untrustworthy(
            MarketErrorCode.InvalidMarketResponse,
            'it carries no single fulfilment transaction to send',
            request,
        );
    }

    private requireWithinDeadline(prepared: PrepareAcceptanceResponse, stage: MarketActionStage): void {
        if (this.nowSeconds() < effectiveAcceptanceDeadline(prepared)) {
            return;
        }

        throw new MarketError({
            code: MarketErrorCode.PreparedIntentExpired,
            message:
                'This prepared acceptance is past the earlier of its own deadline and the offer expiry, so it can ' +
                'no longer be sent. No Cell was sold. Call the tool again for the same exact offer.',
            retryable: false,
            retryAfterSeconds: null,
            stage,
            txHash: null,
        });
    }

    private requirePrepared(payload: AcceptanceRecoveryPayload): PrepareAcceptanceResponse {
        if (payload.prepared === null) {
            throw new MarketError({
                code: MarketErrorCode.InvalidMarketResponse,
                message: 'The acceptance has no prepared offer to fulfil.',
                retryable: false,
                retryAfterSeconds: null,
                stage: MarketActionStage.Fulfil,
                txHash: null,
            });
        }

        return payload.prepared;
    }

    private requireFulfilmentHash(payload: AcceptanceRecoveryPayload): string {
        if (payload.fulfilmentTxHash === null) {
            throw new MarketError({
                code: MarketErrorCode.InvalidMarketResponse,
                message: 'The acceptance has no broadcast fulfilment transaction to verify.',
                retryable: false,
                retryAfterSeconds: null,
                stage: MarketActionStage.Verify,
                txHash: null,
            });
        }

        return payload.fulfilmentTxHash;
    }

    private requireUsableRequest(request: AcceptCellOfferRequest): AcceptCellOfferRequest {
        const orderHash = orderHashSchema.safeParse(request.orderHash);
        if (!orderHash.success) {
            throw this.rejectedInput(
                `"${request.orderHash}" is not a Market order hash. Pass the exact 32-byte 0x-prefixed ` +
                    '`orderHash` of the offer you decided to accept — this tool never picks an offer for you.',
            );
        }

        if (request.tokenId === null) {
            return { orderHash: orderHash.data, tokenId: null };
        }

        const tokenId = cellTokenIdSchema.safeParse(request.tokenId);
        if (!tokenId.success) {
            throw this.rejectedInput(
                `"${request.tokenId}" is not a canonical Cell token id. Pass a decimal integer with no leading ` +
                    'zeroes so that one Cell keeps one identity.',
            );
        }

        return { orderHash: orderHash.data, tokenId: tokenId.data };
    }

    private reserve(key: string, stage: MarketActionStage, payload: AcceptanceRecoveryPayload): void {
        this.recovery.write(key, { tool: MarketActionTool.AcceptCellOffer, stage, payload });
    }

    private emptyPayload(): AcceptanceRecoveryPayload {
        return { prepared: null, approvalTxHashes: [], fulfilmentTxHash: null };
    }

    private result(
        status: MarketActionStatus,
        request: AcceptCellOfferRequest,
        payload: AcceptanceRecoveryPayload,
        hash: string,
    ): AcceptCellOfferResult {
        const prepared = this.requirePrepared(payload);

        this.logger.info('the Cell sale is confirmed', {
            tokenId: prepared.tokenId,
            status,
            orderHash: request.orderHash,
            txHash: hash,
        });

        return {
            status,
            stage: MarketActionStage.Verify,
            wallet: this.walletAddress(),
            tokenId: prepared.tokenId,
            orderHash: request.orderHash,
            offer: prepared.offer,
            buyer: prepared.offer.maker,
            amount: prepared.offer.amount,
            currency: prepared.offer.currency,
            approvalTxHashes: [...payload.approvalTxHashes],
            fulfilmentTxHash: hash,
            txHashes: [...payload.approvalTxHashes, hash],
        };
    }

    private lostBroadcast(
        request: AcceptCellOfferRequest,
        payload: AcceptanceRecoveryPayload,
        reason: string,
    ): MarketError {
        this.logger.error('the fulfilment broadcast left an uncertain outcome', {
            orderHash: request.orderHash,
            reason,
        });

        return new MarketError({
            code: MarketErrorCode.NetworkFailure,
            message:
                `The acceptance of offer ${request.orderHash} could not be confirmed as broadcast: ${reason}. No ` +
                `second fulfilment was sent in this call. ${this.knownHashes(payload, null)} Repeating this call ` +
                'targets that same exact offer and the same Cell, and can never sell another one; at worst it ' +
                'spends gas on a transaction the protocol rejects.',
            retryable: true,
            retryAfterSeconds: null,
            stage: MarketActionStage.Fulfil,
            txHash: null,
        });
    }

    private knownHashes(payload: AcceptanceRecoveryPayload, hash: string | null): string {
        const hashes = [...payload.approvalTxHashes, ...(hash === null ? [] : [hash])];

        return hashes.length === 0
            ? 'No transaction was broadcast.'
            : `Transactions broadcast in order: ${hashes.join(', ')}.`;
    }

    private unavailable(request: AcceptCellOfferRequest, detail: string): MarketError {
        this.logger.error('the pinned Market offer cannot be accepted', { orderHash: request.orderHash, detail });

        return new MarketError({
            code: MarketErrorCode.OrderUnavailable,
            message:
                `Offer ${request.orderHash} cannot be accepted: ${detail}. No replacement offer was selected and ` +
                'nothing was sold. Read the market again and pass another exact `orderHash` if you still want to ' +
                'sell that Cell.',
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Prepare,
            txHash: null,
        });
    }

    private untrustworthy(code: MarketErrorCode, detail: string, request: AcceptCellOfferRequest): MarketError {
        this.logger.error('the prepared acceptance does not match the request', {
            orderHash: request.orderHash,
            detail,
        });

        return new MarketError({
            code,
            message: `The prepared acceptance of offer ${request.orderHash} cannot be sent: ${detail}.`,
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
