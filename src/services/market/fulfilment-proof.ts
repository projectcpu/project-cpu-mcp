import { MarketError } from './error.js';
import {
    SeaportOrderEvent,
    type IFulfilmentTransactionReader,
    type IMarketFulfilmentProof,
    type MarketFulfilmentProofOptions,
    type OrderCancellationProof,
    type OrderFulfilmentProof,
    type OrderProofRequest,
} from './fulfilment-proof.types.js';
import { cancellationOfOrder, fulfilmentOfOrder, type SeaportFulfilmentEvent } from './fulfilment-proof.utils.js';
import { sameAddress } from './listing.utils.js';
import { MarketErrorCode } from './types.js';
import { SEAPORT_ADDRESS } from '../../contracts/seaport.constants.js';
import type { ILogger } from '../../logger/types.js';

export class MarketFulfilmentProof implements IMarketFulfilmentProof {
    private readonly transactions: IFulfilmentTransactionReader;
    private readonly logger: ILogger;

    constructor(options: MarketFulfilmentProofOptions) {
        this.transactions = options.transactions;
        this.logger = options.logger;
    }

    async requireFulfilment(request: OrderProofRequest): Promise<OrderFulfilmentProof> {
        const event = fulfilmentOfOrder(request.receipt.logs, request.orderHash);
        if (event === null) {
            throw this.noOrderEvent(request, SeaportOrderEvent.Fulfilled);
        }

        const sender = await this.requireSender(request);
        if (!sameAddress(sender, request.wallet)) {
            throw this.wrongParty(request, `it was sent by ${sender} rather than this wallet ${request.wallet}`);
        }
        if (!sameAddress(event.recipient, request.wallet)) {
            throw this.wrongParty(request, `it handed the offered items to ${event.recipient}, not to this wallet`);
        }
        this.requireBoundCell(request, event);

        return { orderHash: request.orderHash, offerer: event.offerer, recipient: event.recipient, sender };
    }

    // The order hash proves which order settled; only the items in its own event prove which Cell
    // moved. Without this, a preparation whose calldata names another Cell of the same wallet would
    // be paid for first and questioned afterwards.
    private requireBoundCell(request: OrderProofRequest, event: SeaportFulfilmentEvent): void {
        const bound = request.boundCell;
        if (bound === null) {
            return;
        }

        const matched = event.items.some(
            (item) => sameAddress(item.token, bound.collection) && item.identifier === bound.tokenId,
        );
        if (matched) {
            return;
        }

        const moved = event.items
            .filter((item) => sameAddress(item.token, bound.collection))
            .map((item) => item.identifier);
        const named = moved.length === 0 ? 'no Cell of that collection at all' : `Cell(s) ${moved.join(', ')}`;

        throw this.wrongParty(
            request,
            `it moved ${named} rather than the Cell ${bound.tokenId} this call was bound to`,
        );
    }

    async requireCancellation(request: OrderProofRequest): Promise<OrderCancellationProof> {
        const event = cancellationOfOrder(request.receipt.logs, request.orderHash);
        if (event === null) {
            throw this.noOrderEvent(request, SeaportOrderEvent.Cancelled);
        }

        if (!sameAddress(event.offerer, request.wallet)) {
            throw this.wrongParty(request, `the cancelled order was made by ${event.offerer}, not by this wallet`);
        }

        const sender = await this.requireSender(request);
        if (!sameAddress(sender, request.wallet)) {
            throw this.wrongParty(request, `it was sent by ${sender} rather than this wallet ${request.wallet}`);
        }

        return { orderHash: request.orderHash, offerer: event.offerer, sender };
    }

    private async requireSender(request: OrderProofRequest): Promise<string> {
        const sender = await this.transactions.senderOf(request.receipt.transactionHash);
        if (sender !== null) {
            return sender;
        }

        this.logger.warn('the sending wallet of a mined market transaction could not be read back', {
            txHash: request.receipt.transactionHash,
            orderHash: request.orderHash,
        });
        throw new MarketError({
            code: MarketErrorCode.OutcomeUnknown,
            message:
                `Transaction ${request.receipt.transactionHash} was mined, but the wallet that sent it could not ` +
                `be read back, so it does not yet prove that this wallet acted on order ${request.orderHash}. ` +
                'Nothing further was sent. Repeating this call re-checks the same transaction instead of sending ' +
                'another one.',
            retryable: true,
            retryAfterSeconds: null,
            stage: request.stage,
            txHash: request.receipt.transactionHash,
        });
    }

    private noOrderEvent(request: OrderProofRequest, event: SeaportOrderEvent): MarketError {
        this.logger.error('a mined market transaction carries no event for the exact order', {
            txHash: request.receipt.transactionHash,
            orderHash: request.orderHash,
            event,
        });

        return new MarketError({
            code: MarketErrorCode.InvalidMarketResponse,
            message:
                `Transaction ${request.receipt.transactionHash} succeeded but carries no ${event} log from the ` +
                `pinned protocol contract ${SEAPORT_ADDRESS} for order ${request.orderHash}, so it does not prove ` +
                'that this exact order was acted on. No other order was considered in its place.',
            retryable: false,
            retryAfterSeconds: null,
            stage: request.stage,
            txHash: request.receipt.transactionHash,
        });
    }

    private wrongParty(request: OrderProofRequest, detail: string): MarketError {
        this.logger.error('a market order event names another party than this wallet', {
            txHash: request.receipt.transactionHash,
            orderHash: request.orderHash,
            detail,
        });

        return new MarketError({
            code: MarketErrorCode.WrongOwner,
            message:
                `Transaction ${request.receipt.transactionHash} acts on order ${request.orderHash}, but ${detail}. ` +
                'It therefore does not prove that this wallet completed the action.',
            retryable: false,
            retryAfterSeconds: null,
            stage: request.stage,
            txHash: request.receipt.transactionHash,
        });
    }
}
