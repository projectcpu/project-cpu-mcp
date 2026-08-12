import { parseEventLogs, type Address, type Log } from 'viem';

import { REVEAL_FEE_BUFFER_BPS } from './reveal.constants.js';
import type { RevealDepositView } from './types.js';
import { CELL_ABI } from '../contracts/cell.abi.js';
import { sameAddress, sameTokenId } from '../randomness/request.utils.js';
import type { ResourceNames } from '../utils/format.utils.js';
import { BPS_DENOMINATOR } from '../wallet/constants.js';

export interface RevealRequestedView {
    requestId: bigint;
    source: Address;
}

/**
 * The ETH a reveal transaction carries: the quoted total plus headroom. The randomness leg of the quote is
 * read in an `eth_call`, where it can price lower than the send is charged, so a transaction carrying the
 * quote exactly can still underpay. The headroom goes on the total for that reason — a share of the fee leg
 * alone would be zero exactly when it is needed. The excess is refunded inside the same transaction, so
 * the reveal still costs the quoted total.
 */
export function bufferedRevealValue(totalRequiredWei: bigint): bigint {
    return totalRequiredWei + (totalRequiredWei * REVEAL_FEE_BUFFER_BPS) / BPS_DENOMINATOR;
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
