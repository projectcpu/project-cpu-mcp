import type { BuyCellResult } from '../../../services/market/purchase.types.js';
import { MarketActionStatus } from '../../../services/market/types.js';

export function summarizeBoughtCell(result: BuyCellResult): string {
    const opening =
        result.status === MarketActionStatus.AlreadyCompleted
            ? `Cell ${result.tokenId} was already bought on this exact order — no second purchase was made`
            : `Cell ${result.tokenId} is bought`;
    const approvals =
        result.approvalTxHashes.length === 0
            ? 'no currency approval was needed'
            : `currency approvals broadcast in order: ${result.approvalTxHashes.join(', ')}`;

    return [
        `${opening} (order ${result.orderHash}, buyer ${result.wallet}, seller ${result.seller})`,
        `paid: ${result.price} ${result.currency.symbol} base units (decimals=${result.currency.decimals}), ` +
            `within your ceiling of ${result.maxAmount}`,
        approvals,
        `fulfilment transaction: ${result.fulfilmentTxHash}`,
    ].join('\n');
}
