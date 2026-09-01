import type { Address, Hex } from 'viem';

import {
    MarketActionTool,
    type IMarketRecoveryStore,
    type IMarketSingleFlight,
    type MarketRecoveryRecord,
} from './action.types.js';
import {
    CANCELLATION_NO_VALUE,
    CANCELLATION_SINGLE_ORDER,
    MARKET_CANCELLATION_PREPARE_PATH,
} from './cancel.constants.js';
import {
    prepareCancellationResponseSchema,
    type CancellationRecoveryPayload,
    type CancelledOrderCall,
    type CancelOrderRequest,
    type CancelOrderResult,
    type IMarketCancelService,
    type MarketCancelServiceOptions,
    type PrepareCancellationResponse,
} from './cancel.types.js';
import { cancellationActionInputs, cancellationTransaction, cancelledOrders } from './cancel.utils.js';
import type { IMarketSingleShotClient } from './client.types.js';
import { MarketError } from './error.js';
import type { IMarketFulfilmentProof } from './fulfilment-proof.types.js';
import { marketActionKey } from './idempotency.utils.js';
import { sameAddress } from './listing.utils.js';
import { sameOrderHash } from './purchase.utils.js';
import {
    MarketActionStage,
    MarketActionStatus,
    MarketErrorCode,
    orderHashSchema,
    type MarketTransaction,
} from './types.js';
import { SEAPORT_ADDRESS } from '../../contracts/seaport.constants.js';
import type { ILogger } from '../../logger/types.js';
import { errorMessage } from '../../utils/error.utils.js';
import { TxStatus, type TxReceipt, type WalletProvider } from '../../wallet/types.js';

export class MarketCancelService implements IMarketCancelService {
    private readonly client: IMarketSingleShotClient;
    private readonly proof: IMarketFulfilmentProof;
    private readonly wallet: WalletProvider;
    private readonly network: string;
    private readonly singleFlight: IMarketSingleFlight;
    private readonly recovery: IMarketRecoveryStore;
    private readonly logger: ILogger;

    constructor(options: MarketCancelServiceOptions) {
        this.client = options.client;
        this.proof = options.proof;
        this.wallet = options.wallet;
        this.network = options.network;
        this.singleFlight = options.singleFlight;
        this.recovery = options.recovery;
        this.logger = options.logger;
    }

    async cancelOrder(request: CancelOrderRequest): Promise<CancelOrderResult> {
        const validated = this.requireUsableRequest(request);
        const key = marketActionKey({
            wallet: this.walletAddress(),
            network: this.network,
            tool: MarketActionTool.CancelOrder,
            inputs: cancellationActionInputs(validated),
        });

        return this.singleFlight.run(key, async () => this.cancel(key, validated));
    }

    private async cancel(key: string, request: CancelOrderRequest): Promise<CancelOrderResult> {
        const unresolved = this.recovery.read<CancellationRecoveryPayload>(key);
        if (unresolved !== null && unresolved.payload.cancellationTxHash !== null) {
            return this.settleKnownCancellation(key, request, unresolved);
        }

        this.reserve(key, MarketActionStage.Prepare, { prepared: null, cancellationTxHash: null });

        let prepared: PrepareCancellationResponse;
        try {
            prepared = await this.prepare(request);
        } catch (error) {
            this.recovery.forget(key);
            throw error;
        }

        const payload: CancellationRecoveryPayload = { prepared, cancellationTxHash: null };
        this.reserve(key, MarketActionStage.Prepare, payload);

        return this.broadcast(key, request, payload);
    }

    private async broadcast(
        key: string,
        request: CancelOrderRequest,
        payload: CancellationRecoveryPayload,
    ): Promise<CancelOrderResult> {
        let transaction: MarketTransaction;
        try {
            transaction = this.requireCancellationTransaction(request, this.requirePrepared(payload));
        } catch (error) {
            this.recovery.forget(key);
            throw error;
        }

        let hash: string;
        try {
            hash = await this.send(transaction);
        } catch (error) {
            this.reserve(key, MarketActionStage.Cancel, payload);
            throw this.lostBroadcast(request, errorMessage(error));
        }

        const sent: CancellationRecoveryPayload = { ...payload, cancellationTxHash: hash };
        this.reserve(key, MarketActionStage.Cancel, sent);

        return this.settle(key, request, sent, MarketActionStatus.Completed);
    }

    private async settleKnownCancellation(
        key: string,
        request: CancelOrderRequest,
        record: MarketRecoveryRecord<CancellationRecoveryPayload>,
    ): Promise<CancelOrderResult> {
        this.logger.info(
            'a cancellation of this exact order is already on-chain — proving it instead of sending again',
            {
                orderHash: request.orderHash,
                txHash: record.payload.cancellationTxHash,
            },
        );

        return this.settle(key, request, record.payload, MarketActionStatus.AlreadyCompleted);
    }

    private async settle(
        key: string,
        request: CancelOrderRequest,
        payload: CancellationRecoveryPayload,
        status: MarketActionStatus,
    ): Promise<CancelOrderResult> {
        const hash = this.requireCancellationHash(payload);
        const receipt = await this.confirm(key, request, hash);

        try {
            await this.proof.requireCancellation({
                receipt,
                orderHash: request.orderHash,
                wallet: this.walletAddress(),
                stage: MarketActionStage.Verify,
                boundCell: null,
            });
        } catch (error) {
            this.forgetDisprovenCancellation(key, error);
            throw error;
        }

        this.recovery.forget(key);
        return this.result(status, request, payload, hash);
    }

    private forgetDisprovenCancellation(key: string, error: unknown): void {
        if (error instanceof MarketError && !error.retryable) {
            this.recovery.forget(key);
        }
    }

    private async confirm(key: string, request: CancelOrderRequest, hash: string): Promise<TxReceipt> {
        let receipt: TxReceipt;
        try {
            receipt = await this.wallet.get().waitForReceipt(hash as `0x${string}`);
        } catch (error) {
            throw new MarketError({
                code: MarketErrorCode.OutcomeUnknown,
                message:
                    `The cancellation of order ${request.orderHash} was broadcast as ${hash}, but its receipt could ` +
                    `not be read: ${errorMessage(error)}. The transaction is kept, so repeating this call re-checks ` +
                    'that exact transaction instead of cancelling anything else.',
                retryable: true,
                retryAfterSeconds: null,
                stage: MarketActionStage.Cancel,
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
                `The cancellation of order ${request.orderHash} reverted on-chain, so that order is not cancelled ` +
                'and nothing was spent beyond gas. It may have been filled, cancelled or expired meanwhile; read ' +
                'your orders again before deciding what to do.',
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Cancel,
            txHash: hash,
        });
    }

    private async prepare(request: CancelOrderRequest): Promise<PrepareCancellationResponse> {
        const prepared = await this.client.sendOnce({
            path: MARKET_CANCELLATION_PREPARE_PATH,
            method: 'POST',
            body: { orderHash: request.orderHash },
            schema: prepareCancellationResponseSchema,
            stage: MarketActionStage.Prepare,
            label: `Preparing the cancellation of order ${request.orderHash}`,
        });

        this.requireTrustworthyPreparation(request, prepared);
        return prepared;
    }

    private requireTrustworthyPreparation(request: CancelOrderRequest, prepared: PrepareCancellationResponse): void {
        const chainId = this.wallet.get().getChainId();
        const transaction = this.requireCancellationTransaction(request, prepared);

        if (transaction.chainId !== chainId) {
            throw this.untrustworthy(
                MarketErrorCode.ChainMismatch,
                `it targets chain ${transaction.chainId} while this wallet cancels on chain ${chainId}`,
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
        if (!sameOrderHash(prepared.orderHash, request.orderHash)) {
            throw this.unavailable(
                request,
                `the marketplace answered with order ${prepared.orderHash} instead of the order you pinned`,
            );
        }
        // The canonical backend DTO no longer repeats maker/order metadata outside the transaction.
        // requireCancellationTransaction validates the same security boundary from the calldata that is sent.
    }

    private requireCancellationTransaction(
        request: CancelOrderRequest,
        prepared: PrepareCancellationResponse,
    ): MarketTransaction {
        const chainId = this.wallet.get().getChainId();
        const transactions = [prepared.transaction];
        const transaction = cancellationTransaction(transactions);

        if (transaction === null) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                'cancelling one order takes exactly one cancellation transaction, and it asks to send ' +
                    `${this.describeTransactions(transactions)}`,
                request,
            );
        }
        if (transaction.chainId !== chainId) {
            throw this.untrustworthy(
                MarketErrorCode.ChainMismatch,
                `it asks to send the cancellation on chain ${transaction.chainId} while this wallet cancels on ` +
                    `chain ${chainId}`,
                request,
            );
        }
        if (!sameAddress(transaction.to, SEAPORT_ADDRESS)) {
            throw this.untrustworthy(
                MarketErrorCode.ProtocolAddressMismatch,
                `it asks to send the cancellation to ${transaction.to} instead of the pinned protocol contract ` +
                    `${SEAPORT_ADDRESS}`,
                request,
            );
        }
        if (transaction.value !== CANCELLATION_NO_VALUE) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `it asks to send ${transaction.value} native base units with a cancellation, which costs nothing ` +
                    'beyond gas',
                request,
            );
        }

        this.requireCancellationOfPinnedOrder(request, transaction);
        return transaction;
    }

    private requireCancellationOfPinnedOrder(request: CancelOrderRequest, transaction: MarketTransaction): void {
        const orders = cancelledOrders(transaction.data);

        if (orders === null) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                'it asks to send calldata the protocol contract would not read as an order cancellation',
                request,
            );
        }
        if (orders.length !== CANCELLATION_SINGLE_ORDER) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `its calldata would cancel ${orders.length} orders rather than the single order you named`,
                request,
            );
        }

        const only = orders[0] as CancelledOrderCall;
        if (!sameAddress(only.offerer, this.walletAddress())) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `its calldata would cancel an order signed by ${only.offerer} rather than by this wallet ` +
                    `${this.walletAddress()}`,
                request,
            );
        }
        if (!sameOrderHash(only.orderHash, request.orderHash)) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                `its calldata would cancel order ${only.orderHash} rather than the order ${request.orderHash} you ` +
                    'named',
                request,
            );
        }
        if (only.kind === null) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                'its calldata does not carry the Cell on exactly one side of the order',
                request,
            );
        }
    }

    private describeTransactions(transactions: ReadonlyArray<MarketTransaction>): string {
        return transactions.length === 0
            ? 'nothing at all'
            : `${transactions.length} transaction(s): ${transactions.map((transaction) => transaction.kind).join(', ')}`;
    }

    private async send(transaction: MarketTransaction): Promise<string> {
        return this.wallet.get().sendTransaction({
            to: transaction.to as Address,
            data: transaction.data as Hex,
            value: BigInt(transaction.value),
            gas: null,
        });
    }

    private requirePrepared(payload: CancellationRecoveryPayload): PrepareCancellationResponse {
        if (payload.prepared === null) {
            throw new MarketError({
                code: MarketErrorCode.InvalidMarketResponse,
                message: 'The cancellation has no prepared order to send.',
                retryable: false,
                retryAfterSeconds: null,
                stage: MarketActionStage.Cancel,
                txHash: null,
            });
        }

        return payload.prepared;
    }

    private requireCancellationHash(payload: CancellationRecoveryPayload): string {
        if (payload.cancellationTxHash === null) {
            throw new MarketError({
                code: MarketErrorCode.InvalidMarketResponse,
                message: 'The cancellation has no broadcast transaction to verify.',
                retryable: false,
                retryAfterSeconds: null,
                stage: MarketActionStage.Verify,
                txHash: null,
            });
        }

        return payload.cancellationTxHash;
    }

    private requireUsableRequest(request: CancelOrderRequest): CancelOrderRequest {
        const orderHash = orderHashSchema.safeParse(request.orderHash);
        if (orderHash.success) {
            return { orderHash: orderHash.data };
        }

        throw new MarketError({
            code: MarketErrorCode.InvalidInput,
            message:
                `"${request.orderHash}" is not a Market order hash. Pass the exact 32-byte 0x-prefixed \`orderHash\` ` +
                'of your own listing or offer — this tool never picks an order for you.',
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Prepare,
            txHash: null,
        });
    }

    private reserve(key: string, stage: MarketActionStage, payload: CancellationRecoveryPayload): void {
        this.recovery.write(key, { tool: MarketActionTool.CancelOrder, stage, payload });
    }

    private result(
        status: MarketActionStatus,
        request: CancelOrderRequest,
        payload: CancellationRecoveryPayload,
        hash: string,
    ): CancelOrderResult {
        const prepared = this.requirePrepared(payload);
        const order = (cancelledOrders(prepared.transaction.data) ?? [])[0] as CancelledOrderCall | undefined;

        if (order === undefined || order.kind === null) {
            throw this.untrustworthy(
                MarketErrorCode.InvalidMarketResponse,
                'the confirmed cancellation no longer describes one listing or offer',
                request,
            );
        }

        this.logger.info('the Market order cancellation is confirmed', {
            status,
            orderHash: request.orderHash,
            txHash: hash,
        });

        return {
            status,
            stage: MarketActionStage.Verify,
            wallet: this.walletAddress(),
            orderHash: request.orderHash,
            orderKind: order.kind,
            tokenId: order.tokenId,
            cancellationTxHash: hash,
            txHashes: [hash],
        };
    }

    private lostBroadcast(request: CancelOrderRequest, reason: string): MarketError {
        this.logger.error('the cancellation broadcast left an uncertain outcome', {
            orderHash: request.orderHash,
            reason,
        });

        return new MarketError({
            code: MarketErrorCode.NetworkFailure,
            message:
                `The cancellation of order ${request.orderHash} could not be confirmed as broadcast: ${reason}. No ` +
                'second cancellation was sent in this call. Repeating this call targets that same exact order and ' +
                'can never cancel another one; at worst it spends gas on a transaction the protocol rejects.',
            retryable: true,
            retryAfterSeconds: null,
            stage: MarketActionStage.Cancel,
            txHash: null,
        });
    }

    private unavailable(request: CancelOrderRequest, detail: string): MarketError {
        this.logger.error('the pinned Market order cannot be cancelled', {
            orderHash: request.orderHash,
            detail,
        });

        return new MarketError({
            code: MarketErrorCode.OrderUnavailable,
            message:
                `Order ${request.orderHash} cannot be cancelled: ${detail}. No other order was cancelled in its ` +
                'place. Read your own orders again and pass another exact `orderHash` if you still want to cancel ' +
                'one.',
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Prepare,
            txHash: null,
        });
    }

    private untrustworthy(code: MarketErrorCode, detail: string, request: CancelOrderRequest): MarketError {
        this.logger.error('the prepared cancellation does not match the request', {
            orderHash: request.orderHash,
            detail,
        });

        return new MarketError({
            code,
            message: `The prepared cancellation of order ${request.orderHash} cannot be sent: ${detail}.`,
            retryable: false,
            retryAfterSeconds: null,
            stage: MarketActionStage.Prepare,
            txHash: null,
        });
    }

    private walletAddress(): string {
        return this.wallet.get().getAddress();
    }
}
