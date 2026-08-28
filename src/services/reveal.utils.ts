import { parseEventLogs, type Address, type Log } from 'viem';

import { REVEAL_PAYMENT_BUFFER_BPS } from './reveal.constants.js';
import type { RevealDepositView } from './types.js';
import { BPS_DENOMINATOR } from '../config/constants.js';
import { CELL_ABI } from '../contracts/cell.abi.js';
import { sameAddress, sameTokenId } from '../randomness/request.utils.js';
import type { ResourceNames } from '../utils/format.utils.js';

export interface RevealRequestedView {
    requestId: bigint;
    source: Address;
}

/**
 * The ETH a reveal transaction carries: the quoted budget plus headroom. Governance can move the configured
 * budget between the quote and the send; the excess is refunded inside the same transaction, so an unchanged
 * budget still costs exactly what the Cell quoted.
 */
export function bufferedRevealValue(ethBudgetWei: bigint): bigint {
    return ethBudgetWei + (ethBudgetWei * REVEAL_PAYMENT_BUFFER_BPS) / BPS_DENOMINATOR;
}

export function revealRequestedOf(logs: Array<Log>, cell: Address, tokenId: string): RevealRequestedView | null {
    const events = parseEventLogs({ abi: CELL_ABI, eventName: 'RevealRequested', logs });
    const event = events.find(
        (candidate) => sameAddress(candidate.address, cell) && sameTokenId(candidate.args.tokenId.toString(), tokenId),
    );
    return event === undefined ? null : { requestId: event.args.requestId, source: event.args.source };
}

export function revealDepositsOf(
    logs: Array<Log>,
    cell: Address,
    requestId: bigint,
    resources: ResourceNames,
): Array<RevealDepositView> | null {
    const events = parseEventLogs({ abi: CELL_ABI, eventName: 'RevealFulfilled', logs });
    const event = events.find(
        (candidate) => sameAddress(candidate.address, cell) && candidate.args.requestId === requestId,
    );
    if (event === undefined) {
        return null;
    }
    const drawn: Array<RevealDepositView> = [];
    event.args.resources.forEach((resourceId, slot) => {
        const amount = event.args.amounts[slot] ?? 0n;
        if (resourceId === 0 || amount === 0n) {
            return;
        }
        drawn.push({
            resourceId,
            resourceName: resources[resourceId] ?? null,
            amount: amount.toString(),
            strength: event.args.strengths[slot] ?? 0,
        });
    });
    return drawn;
}
