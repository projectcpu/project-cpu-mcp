import type { CancelOrderResult } from '../../../services/market/cancel.types.js';
import { MarketActionStatus } from '../../../services/market/types.js';

export function summarizeCancelledOrder(result: CancelOrderResult): string {
    const opening =
        result.status === MarketActionStatus.AlreadyCompleted
            ? `Your ${result.orderKind} was already cancelled on-chain — no second cancellation was sent`
            : `Your ${result.orderKind} is cancelled`;
    const subject = result.tokenId === null ? 'it names no single Cell' : `it was made on Cell ${result.tokenId}`;

    return [
        `${opening} (order ${result.orderHash}, maker ${result.wallet})`,
        subject,
        `cancellation transaction: ${result.cancellationTxHash}`,
    ].join('\n');
}
