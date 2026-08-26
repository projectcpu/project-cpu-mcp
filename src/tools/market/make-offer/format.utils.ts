import type { MakeCellOfferResult } from '../../../services/market/offer.types.js';
import { MarketActionStatus } from '../../../services/market/types.js';

export function summarizeCellOffer(result: MakeCellOfferResult): string {
    const opening =
        result.status === MarketActionStatus.AlreadyCompleted
            ? `Cell ${result.tokenId} already carries this exact offer of yours — no second offer was published`
            : `Cell ${result.tokenId} now carries your offer`;
    const approvals =
        result.approvalTxHashes.length === 0
            ? 'no currency approval was needed'
            : `currency approvals broadcast in order: ${result.approvalTxHashes.join(', ')}`;

    return [
        `${opening} (order ${result.offer.orderHash}, buyer ${result.wallet})`,
        `you bid: ${result.amount} ${result.currency.symbol} base units (decimals=${result.currency.decimals})`,
        `expires at ${result.offer.expirationTime}`,
        approvals,
    ].join('\n');
}
