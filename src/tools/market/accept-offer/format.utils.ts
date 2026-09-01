import type { AcceptCellOfferResult } from '../../../services/market/acceptance.types.js';
import { MarketActionStatus, MarketOfferKind } from '../../../services/market/types.js';

function offerShape(kind: MarketOfferKind): string {
    return kind === MarketOfferKind.Item
        ? 'an offer for that exact Cell'
        : `a ${kind} offer, which may stay active and buy other Cells`;
}

export function summarizeSoldCell(result: AcceptCellOfferResult): string {
    const opening =
        result.status === MarketActionStatus.AlreadyCompleted
            ? `Cell ${result.tokenId} was already sold on this exact offer — no second sale was made`
            : `Cell ${result.tokenId} is sold`;
    const approvals =
        result.approvalTxHashes.length === 0
            ? 'no collection approval was needed'
            : `collection approvals broadcast in order: ${result.approvalTxHashes.join(', ')}`;

    return [
        `${opening} (order ${result.orderHash}, seller ${result.wallet}, buyer ${result.buyer})`,
        `offer amount before the marketplace's mandatory fee split: ${result.amount} ${result.currency.symbol} ` +
            `base units (decimals=${result.currency.decimals}), from ${offerShape(result.offer.kind)}`,
        approvals,
        `fulfilment transaction: ${result.fulfilmentTxHash}`,
    ].join('\n');
}
