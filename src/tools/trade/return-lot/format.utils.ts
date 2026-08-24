import { DESTINATION_TRANSFER_WARNING } from './constants.js';
import { LotState } from '../../../api/types.js';
import { LotReturnBranch, type LotReturnQuote, type LotReturnResult } from '../../../services/types.js';
import { formatUnixSeconds, resourceLabel, summarizeTransit, type ResourceNames } from '../../../utils/format.utils.js';

function describeCapacity(quote: LotReturnQuote): string {
    if (quote.capacity.free === null) {
        return `Cell ${quote.destinationTokenId} has uncapped storage for this resource, so the whole remainder fits.`;
    }
    if (quote.capacity.fits) {
        return (
            `Cell ${quote.destinationTokenId} has ${quote.capacity.free} free right now (what it holds and ` +
            `everything reserved on it counted), so the ${quote.capacity.required} units fit.`
        );
    }
    return (
        `Cell ${quote.destinationTokenId} does not fit the whole remainder: ${quote.capacity.required} units need ` +
        `room and only ${quote.capacity.free} are free (what it holds and everything reserved on it counted). ` +
        `Free the space or pick another cell you own — cpu_return_lot refuses before it approves anything.`
    );
}

export function summarizeLotReturnQuote(quote: LotReturnQuote, resources: ResourceNames): string {
    return (
        `Lot ${quote.lotId} return: the whole remainder, ${quote.amount} ` +
        `${resourceLabel(resources, quote.resourceId)}, from Hub ${quote.hubTokenId} to your cell ` +
        `${quote.destinationTokenId} over ${quote.totalDistance} grid steps, arriving ` +
        `${formatUnixSeconds(quote.arrivalAt)}. Transit fee ` +
        `${summarizeTransit(quote.transitPaid, quote.transitDiscount)} — cpu_return_lot carries exactly this fee ` +
        `as its ceiling, so quote it again if you wait. ${describeCapacity(quote)}`
    );
}

export function summarizeLotReturn(result: LotReturnResult, resources: ResourceNames): string {
    const approve = result.approveTxHash !== null ? `approve tx ${result.approveTxHash}, ` : '';
    const branch =
        result.branch === LotReturnBranch.Reclaimed
            ? `reclaimed the remainder of evicted lot ${result.lotId}`
            : `cancelled lot ${result.lotId}`;
    const wasEvicted = result.originalState === LotState.Evicted ? ' It no longer blocks new lots on that hub.' : '';
    return (
        `Returned lot ${result.lotId}: ${branch} on Hub ${result.hubTokenId} and sent the whole remainder, ` +
        `${result.returned} ${resourceLabel(resources, result.resourceId)}, home to cell ` +
        `${result.destinationTokenId} (delivery ${result.deliveryId}, ETA ${formatUnixSeconds(result.arrivalAt)}) — ` +
        `run finalize_delivery on ${result.deliveryId} after the ETA to take them in.${wasEvicted} Transit fee ` +
        `${summarizeTransit(result.transitPaid, result.transitDiscount)}. ${DESTINATION_TRANSFER_WARNING} ` +
        `${approve}return tx ${result.txHash} in block ${result.blockNumber}.`
    );
}
