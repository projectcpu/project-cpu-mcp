import type { Address, Hex } from 'viem';

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
import {
    MARKET_PURCHASE_PREPARE_PATH,
    PURCHASE_EMPTY_CALLDATA,
    PURCHASE_NO_VALUE,
    PURCHASE_START_TIME_SKEW_SECONDS,
} from './purchase.constants.js';
import {
    preparePurchaseResponseSchema,
    type BuyCellRequest,
    type BuyCellResult,
    type IMarketPurchaseService,
    type MarketPurchaseServiceOptions,
    type PreparePurchaseResponse,
    type PurchaseRecoveryPayload,
} from './purchase.types.js';
import {
    effectivePurchaseDeadline,
    exceedsCeiling,
    isNativeCurrency,
    preparedNativeTotal,
    purchaseActionInputs,
    purchaseApprovals,
    purchaseFulfilment,
    sameOrderHash,
} from './purchase.utils.js';
import {
    cellTokenIdSchema,
    evmAddressSchema,
    MarketActionStage,
    MarketActionStatus,
    MarketErrorCode,
    MarketTransactionKind,
    orderHashSchema,
    positiveBaseUnitAmountSchema,
    type MarketTransaction,
} from './types.js';
import { CELL_ABI } from '../../contracts/cell.abi.js';
import { SEAPORT_ADDRESS } from '../../contracts/seaport.constants.js';
import type { ILogger } from '../../logger/types.js';
import { errorMessage } from '../../utils/error.utils.js';
import { TxStatus, type TxReceipt, type WalletProvider } from '../../wallet/types.js';
import type { IAppConfig } from '../types.js';

export class MarketPurchaseService implements IMarketPurchaseService {
    private readonly client: IMarketSingleShotClient;
    private readonly proof: IMarketFulfilmentProof;
    private readonly appConfig: IAppConfig;
    private readonly wallet: WalletProvider;
    private readonly network: string;
    private readonly singleFlight: IMarketSingleFlight;
    private readonly recovery: IMarketRecoveryStore;
    private readonly logger: ILogger;

    constructor(options: MarketPurchaseServiceOptions) {
        this.client = options.client;
        this.proof = options.proof;
        this.appConfig = options.appConfig;
        this.wallet = options.wallet;
        this.network = options.network;
        this.singleFlight = options.singleFlight;
        this.recovery = options.recovery;
        this.logger = options.logger;
    }

    async buyCell(request: BuyCellRequest): Promise<BuyCellResult> {
        const validated = this.requireUsableRequest(request);
        const key = marketActionKey({
            wallet: this.walletAddress(),
            network: this.network,
            tool: MarketActionTool.BuyCell,
            inputs: purchaseActionInputs(validated),
        });

        return this.singleFlight.run(key, async () => this.purchase(key, validated));
    }

    private async purchase(key: string, request: BuyCellRequest): Promise<BuyCellResult> {
        const unresolved = this.recovery.read<PurchaseRecoveryPayload>(key);
        if (unresolved !== null && unresolved.payload.fulfilmentTxHash !== null) {
            return this.settleKnownFulfilment(key, request, unresolved);
        }

        this.reserve(key, MarketActionStage.Prepare, this.emptyPayload());

        let prepared: PreparePurchaseResponse;
        try {
            prepared = await this.prepare(request);
        } catch (error) {
            this.recovery.forget(key);
            throw error;
        }

        let payload: PurchaseRecoveryPayload = { prepared, approvalTxHashes: [], fulfilmentTxHash: null };
        this.reserve(key, MarketActionStage.Prepare, payload);

        for (const approval of purchaseApprovals(prepared)) {
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
        request: BuyCellRequest,
        payload: PurchaseRecoveryPayload,
    ): Promise<BuyCellResult> {
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

        const sent: PurchaseRecoveryPayload = { ...payload, fulfilmentTxHash: hash };
        this.reserve(key, MarketActionStage.Fulfil, sent);

        return this.settle(key, request, sent, MarketActionStatus.Completed);
    }

    private async settleKnownFulfilment(
        key: string,
        request: BuyCellRequest,
        record: MarketRecoveryRecord<PurchaseRecoveryPayload>,
    ): Promise<BuyCellResult> {
        this.logger.info('a purchase of this exact order is already on-chain — proving it instead of sending again', {
            tokenId: request.tokenId,
            orderHash: request.expectedOrderHash,
            txHash: record.payload.fulfilmentTxHash,
        });

        return this.settle(key, request, record.payload, MarketActionStatus.AlreadyCompleted);
    }

    private async settle(
        key: string,
        request: BuyCellRequest,
        payload: PurchaseRecoveryPayload,
        status: MarketActionStatus,
    ): Promise<BuyCellResult> {
        const hash = this.requireFulfilmentHash(payload);
        const receipt = await this.confirm(key, request, payload, hash);

        await this.proof.requireFulfilment({
            receipt,
            orderHash: request.expectedOrderHash,
            wallet: this.walletAddress(),
            stage: MarketActionStage.Verify,
        });
        await this.requireOwnedCell(request, hash);

        this.recovery.forget(key);
        return this.result(status, request, payload, hash);
    }

    private async confirm(
        key: string,
        request: BuyCellRequest,
        payload: PurchaseRecoveryPayload,
        hash: string,
    ): Promise<TxReceipt> {
        let receipt: TxReceipt;
        try {
            receipt = await this.wallet.get().waitForReceipt(hash as `0x${string}`);
        } catch (error) {
            throw new MarketError({
                code: MarketErrorCode.OutcomeUnknown,
                message:
                    `The fulfilment of order ${request.expectedOrderHash} was broadcast as ${hash}, but its receipt ` +
                    `could not be read: ${errorMessage(error)}. The transaction is kept, so repeating this call ` +
                    're-checks that exact transaction instead of buying anything else.',
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
                `The fulfilment of order ${request.expectedOrderHash} reverted on-chain, so Cell ${request.tokenId} ` +
                `was not bought and nothing was paid beyond gas. ${this.knownHashes(payload, hash)} The order may ` +
                'have been filled or cancelled meanwhile; read the market again and pick an exact order.',
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Fulfil,
            txHash: hash,
        });
    }

    private async requireOwnedCell(request: BuyCellRequest, hash: string): Promise<void> {
        const collection = await this.requireCellCollection(MarketActionStage.Verify);

        let owner: string;
        try {
            const cell = (await this.wallet.get().readContract({
                address: collection as Address,
                abi: CELL_ABI,
                functionName: 'getCell',
                args: [BigInt(request.tokenId)],
            })) as { owner: string };
            owner = cell.owner;
        } catch (error) {
            throw new MarketError({
                code: MarketErrorCode.OutcomeUnknown,
                message:
                    `Order ${request.expectedOrderHash} was fulfilled by transaction ${hash}, but who owns Cell ` +
                    `${request.tokenId} now could not be read: ${errorMessage(error)}. The transaction is kept, so ` +
                    'repeating this call re-checks it instead of buying anything else.',
                retryable: true,
                retryAfterSeconds: null,
                stage: MarketActionStage.Verify,
                txHash: hash,
            });
        }

        if (sameAddress(owner, this.walletAddress())) {
            return;
        }

        throw new MarketError({
            code: MarketErrorCode.WrongOwner,
            message:
                `Order ${request.expectedOrderHash} was fulfilled by transaction ${hash}, but Cell ` +
                `${request.tokenId} is owned by ${owner} rather than this wallet ${this.walletAddress()}. ` +
                'The purchase is not reported as yours on that evidence.',
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Verify,
            txHash: hash,
        });
    }

    private async prepare(request: BuyCellRequest): Promise<PreparePurchaseResponse> {
        const prepared = await this.client.sendOnce({
            path: MARKET_PURCHASE_PREPARE_PATH,
            method: 'POST',
            body: { tokenId: request.tokenId, orderHash: request.expectedOrderHash },
            schema: preparePurchaseResponseSchema,
            stage: MarketActionStage.Prepare,
            label: `Preparing the purchase of order ${request.expectedOrderHash}`,
        });

        this.requireTrustworthyPreparation(request, prepared);
        return prepared;
    }

    private requireTrustworthyPreparation(request: BuyCellRequest, prepared: PreparePurchaseResponse): void {
        const wallet = this.walletAddress();
        const chainId = this.wallet.get().getChainId();

        if (prepared.chainId !== chainId || prepared.listing.chainId !== chainId) {
            throw this.untrustworthy(
                MarketErrorCode.ChainMismatch,
                `it targets chain ${prepared.chainId} while this wallet buys on chain ${chainId}`,
                request,
            );
        }
        if (
            !sameAddress(prepared.protocolAddress, SEAPORT_ADDRESS) ||
            !sameAddress(prepared.listing.protocolAddress, SEAPORT_ADDRESS)
        ) {
            throw this.untrustworthy(
                MarketErrorCode.ProtocolAddressMismatch,
                `it names protocol contract ${prepared.protocolAddress} instead of the pinned ${SEAPORT_ADDRESS}`,
                request,
            );
        }

        this.requirePinnedOrder(request, prepared);
        this.requireAffordableOrder(request, prepared);

        if (sameAddress(prepared.listing.maker, wallet)) {
            throw this.untrustworthy(
                MarketErrorCode.WrongOwner,
                `it is your own listing — this wallet ${wallet} is both the seller and the buyer`,
                request,
            );
        }

        this.requireFulfilmentShape(request, prepared);
    }

    private requirePinnedOrder(request: BuyCellRequest, prepared: PreparePurchaseResponse): void {
        const listing = prepared.listing;

        if (!sameOrderHash(listing.orderHash, request.expectedOrderHash)) {
            throw this.unavailable(
                request,
                `the marketplace answered with order ${listing.orderHash} instead of the order you pinned`,
            );
        }
        if (listing.tokenId !== request.tokenId) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `order ${listing.orderHash} sells Cell ${listing.tokenId} rather than the Cell ${request.tokenId} ` +
                    'you named',
                request,
            );
        }

        const now = this.nowSeconds();
        if (listing.expirationTime <= now) {
            throw this.unavailable(request, `it expired at ${listing.expirationTime} and is no longer fillable`);
        }
        if (listing.startTime > now + PURCHASE_START_TIME_SKEW_SECONDS) {
            throw this.unavailable(request, `it does not become fillable until ${listing.startTime}`);
        }
    }

    private requireAffordableOrder(request: BuyCellRequest, prepared: PreparePurchaseResponse): void {
        const listing = prepared.listing;

        if (exceedsCeiling(listing.price, request.maxAmount)) {
            throw this.unavailable(
                request,
                `it now costs ${listing.price} ${listing.currency.symbol} base units, above the maxAmount ` +
                    `${request.maxAmount} you set — nothing was sent`,
            );
        }

        const native = preparedNativeTotal(prepared);
        if (exceedsCeiling(native, request.maxAmount)) {
            throw this.unavailable(
                request,
                `its transactions would send ${native} native base units, above the maxAmount ` +
                    `${request.maxAmount} you set — nothing was sent`,
            );
        }
    }

    private requireFulfilmentShape(request: BuyCellRequest, prepared: PreparePurchaseResponse): void {
        const chainId = this.wallet.get().getChainId();
        const transactions = prepared.transactions;
        const last = transactions.at(-1) ?? null;

        if (last === null || last.kind !== MarketTransactionKind.Fulfilment) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                'it does not end with the one fulfilment transaction that buys the Cell',
                request,
            );
        }
        if (purchaseFulfilment(prepared) === null) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                'it asks to send more than one fulfilment transaction for a single order',
                request,
            );
        }
        if (last.data === PURCHASE_EMPTY_CALLDATA) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                'its fulfilment transaction carries no calldata, so it would buy nothing',
                request,
            );
        }

        const foreignChain = transactions.find((transaction) => transaction.chainId !== chainId);
        if (foreignChain !== undefined) {
            throw this.untrustworthy(
                MarketErrorCode.ChainMismatch,
                `it asks to send a "${foreignChain.kind}" transaction on chain ${foreignChain.chainId} while this ` +
                    `wallet buys on chain ${chainId}`,
                request,
            );
        }

        const foreignKind = transactions
            .slice(0, -1)
            .find((transaction) => transaction.kind !== MarketTransactionKind.CurrencyApproval);
        if (foreignKind !== undefined) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `buying a listing may only need currency approvals before the fulfilment, but it asks to send a ` +
                    `"${foreignKind.kind}" transaction first`,
                request,
            );
        }

        this.requireCurrencyTransactions(request, prepared);
    }

    private requireCurrencyTransactions(request: BuyCellRequest, prepared: PreparePurchaseResponse): void {
        const currency = prepared.listing.currency.address;
        const approvals = purchaseApprovals(prepared);

        if (isNativeCurrency(currency)) {
            if (approvals.length > 0) {
                throw this.untrustworthy(
                    MarketErrorCode.InvalidMarketResponse,
                    'it asks to approve a currency for an order that is paid in the chain native coin',
                    request,
                );
            }
            return;
        }

        const foreignApproval = approvals.find((approval) => !sameAddress(approval.to, currency));
        if (foreignApproval !== undefined) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it asks to approve contract ${foreignApproval.to} instead of the listing currency ${currency}`,
                request,
            );
        }

        const valued = prepared.transactions.find((transaction) => transaction.value !== PURCHASE_NO_VALUE);
        if (valued !== undefined) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it asks to send ${valued.value} native base units for an order priced in ` +
                    `${prepared.listing.currency.symbol}`,
                request,
            );
        }
    }

    private async broadcastApproval(transaction: MarketTransaction, request: BuyCellRequest): Promise<string> {
        const hash = await this.send(transaction);
        const receipt = await this.wallet.get().waitForReceipt(hash as `0x${string}`);

        if (receipt.status !== TxStatus.Success) {
            throw new MarketError({
                code: MarketErrorCode.TransactionReverted,
                message:
                    `The currency approval this purchase needs reverted on-chain, so order ` +
                    `${request.expectedOrderHash} was never fulfilled and nothing was paid beyond gas.`,
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

    private async requireCellCollection(stage: MarketActionStage): Promise<string> {
        const config = await this.appConfig.load();
        const collection = config.contracts.cell;

        if (!evmAddressSchema.safeParse(collection).success) {
            throw new MarketError({
                code: MarketErrorCode.InvalidMarketResponse,
                message:
                    'The Cell collection contract is not configured for this network, so who owns the Cell after a ' +
                    'purchase cannot be checked.',
                retryable: false,
                retryAfterSeconds: null,
                stage,
                txHash: null,
            });
        }

        return collection;
    }

    private requireFulfilmentTransaction(
        prepared: PreparePurchaseResponse,
        request: BuyCellRequest,
    ): MarketTransaction {
        const fulfilment = purchaseFulfilment(prepared);
        if (fulfilment !== null) {
            return fulfilment;
        }

        throw this.untrustworthy(
            MarketErrorCode.InvalidMarketResponse,
            'it carries no single fulfilment transaction to send',
            request,
        );
    }

    private requireWithinDeadline(prepared: PreparePurchaseResponse, stage: MarketActionStage): void {
        if (this.nowSeconds() < effectivePurchaseDeadline(prepared)) {
            return;
        }

        throw new MarketError({
            code: MarketErrorCode.PreparedIntentExpired,
            message:
                'This prepared purchase is past the earlier of its own deadline and the order expiry, so it can no ' +
                'longer be sent. Nothing was bought. Call the tool again for the same exact order.',
            retryable: false,
            retryAfterSeconds: null,
            stage,
            txHash: null,
        });
    }

    private requirePrepared(payload: PurchaseRecoveryPayload): PreparePurchaseResponse {
        if (payload.prepared === null) {
            throw new MarketError({
                code: MarketErrorCode.InvalidMarketResponse,
                message: 'The purchase has no prepared order to fulfil.',
                retryable: false,
                retryAfterSeconds: null,
                stage: MarketActionStage.Fulfil,
                txHash: null,
            });
        }

        return payload.prepared;
    }

    private requireFulfilmentHash(payload: PurchaseRecoveryPayload): string {
        if (payload.fulfilmentTxHash === null) {
            throw new MarketError({
                code: MarketErrorCode.InvalidMarketResponse,
                message: 'The purchase has no broadcast fulfilment transaction to verify.',
                retryable: false,
                retryAfterSeconds: null,
                stage: MarketActionStage.Verify,
                txHash: null,
            });
        }

        return payload.fulfilmentTxHash;
    }

    private requireUsableRequest(request: BuyCellRequest): BuyCellRequest {
        const tokenId = cellTokenIdSchema.safeParse(request.tokenId);
        if (!tokenId.success) {
            throw this.rejectedInput(
                `"${request.tokenId}" is not a canonical Cell token id. Pass a decimal integer with no leading ` +
                    'zeroes so that one Cell keeps one identity.',
            );
        }

        const expectedOrderHash = orderHashSchema.safeParse(request.expectedOrderHash);
        if (!expectedOrderHash.success) {
            throw this.rejectedInput(
                `"${request.expectedOrderHash}" is not a Market order hash. Pass the exact 32-byte 0x-prefixed ` +
                    '`orderHash` of the listing you decided to buy — this tool never picks a listing for you.',
            );
        }

        const maxAmount = positiveBaseUnitAmountSchema.safeParse(request.maxAmount);
        if (!maxAmount.success) {
            throw this.rejectedInput(
                `"${request.maxAmount}" is not a spending ceiling. Pass the most you are willing to pay as a ` +
                    'positive decimal integer of the currency base units, never a decimal fraction.',
            );
        }

        return { tokenId: tokenId.data, expectedOrderHash: expectedOrderHash.data, maxAmount: maxAmount.data };
    }

    private reserve(key: string, stage: MarketActionStage, payload: PurchaseRecoveryPayload): void {
        this.recovery.write(key, { tool: MarketActionTool.BuyCell, stage, payload });
    }

    private emptyPayload(): PurchaseRecoveryPayload {
        return { prepared: null, approvalTxHashes: [], fulfilmentTxHash: null };
    }

    private result(
        status: MarketActionStatus,
        request: BuyCellRequest,
        payload: PurchaseRecoveryPayload,
        hash: string,
    ): BuyCellResult {
        const prepared = this.requirePrepared(payload);

        this.logger.info('the Cell purchase is confirmed', {
            tokenId: request.tokenId,
            status,
            orderHash: request.expectedOrderHash,
            txHash: hash,
        });

        return {
            status,
            stage: MarketActionStage.Verify,
            wallet: this.walletAddress(),
            tokenId: request.tokenId,
            orderHash: request.expectedOrderHash,
            seller: prepared.listing.maker,
            price: prepared.listing.price,
            currency: prepared.listing.currency,
            maxAmount: request.maxAmount,
            approvalTxHashes: [...payload.approvalTxHashes],
            fulfilmentTxHash: hash,
            txHashes: [...payload.approvalTxHashes, hash],
        };
    }

    private lostBroadcast(request: BuyCellRequest, payload: PurchaseRecoveryPayload, reason: string): MarketError {
        this.logger.error('the fulfilment broadcast left an uncertain outcome', {
            tokenId: request.tokenId,
            orderHash: request.expectedOrderHash,
            reason,
        });

        return new MarketError({
            code: MarketErrorCode.NetworkFailure,
            message:
                `The fulfilment of order ${request.expectedOrderHash} could not be confirmed as broadcast: ` +
                `${reason}. No second fulfilment was sent in this call. ${this.knownHashes(payload, null)} ` +
                'Repeating this call targets that same exact order and can never buy another listing; at worst it ' +
                'spends gas on a transaction the protocol rejects.',
            retryable: true,
            retryAfterSeconds: null,
            stage: MarketActionStage.Fulfil,
            txHash: null,
        });
    }

    private knownHashes(payload: PurchaseRecoveryPayload, hash: string | null): string {
        const hashes = [...payload.approvalTxHashes, ...(hash === null ? [] : [hash])];

        return hashes.length === 0
            ? 'No transaction was broadcast.'
            : `Transactions broadcast in order: ${hashes.join(', ')}.`;
    }

    private unavailable(request: BuyCellRequest, detail: string): MarketError {
        this.logger.error('the pinned Market order cannot be bought', {
            tokenId: request.tokenId,
            orderHash: request.expectedOrderHash,
            detail,
        });

        return new MarketError({
            code: MarketErrorCode.OrderUnavailable,
            message:
                `Order ${request.expectedOrderHash} cannot be bought: ${detail}. No replacement listing was ` +
                'selected and nothing was bought. Read the market again and pass another exact `expectedOrderHash` ' +
                'if you still want that Cell.',
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Prepare,
            txHash: null,
        });
    }

    private untrustworthy(code: MarketErrorCode, detail: string, request: BuyCellRequest): MarketError {
        this.logger.error('the prepared purchase does not match the request', {
            tokenId: request.tokenId,
            orderHash: request.expectedOrderHash,
            detail,
        });

        return new MarketError({
            code,
            message: `The prepared purchase of order ${request.expectedOrderHash} cannot be sent: ${detail}.`,
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
