import { parseEventLogs, type Abi, type Address, type Log } from 'viem';

import { LOT_RETURN_REVERT_NAMES, LOT_RETURN_REVERT_REASONS, WEI_CEILING_PATTERN } from './lot-return.constants.js';
import { decodeKnownRevert } from './revert-decode.utils.js';
import { lotStateFromChain } from './trade.helpers.js';
import { LotReturnBranch, type DestinationCapacityView, type OnChainLot } from './types.js';
import { LotState } from '../api/types.js';
import { TRADE_ABI } from '../contracts/trade.abi.js';
import { TRANSPORT_ABI } from '../contracts/transport.abi.js';
import type { ILogger } from '../logger/types.js';
import { cpuFromWei } from '../utils/format.utils.js';

const RETURN_ERROR_ABI = [...TRADE_ABI, ...TRANSPORT_ABI] as unknown as Abi;

export function assertReturnRoute(chain: Array<number>): void {
    if (chain.length < 2) {
        throw new Error(
            'A lot return needs the full route home: [hub, ...waypoints, your destination cell]. ' +
                'Give at least the hub and one cell of your own.',
        );
    }
    const seen = new Set<number>();
    for (const tokenId of chain) {
        if (seen.has(tokenId)) {
            throw new Error(`The route visits cell ${tokenId} twice; a lot return travels each cell once.`);
        }
        seen.add(tokenId);
    }
}

/**
 * The chain is the arbiter of what a lot is: the projection can lag an eviction or a sell-out by a block,
 * and a return sent against a stale state is a spend that reverts.
 */
export function assertReturnableLot(lot: OnChainLot, seller: Address, lotId: string): LotState {
    const state = lotStateFromChain(lot.state);
    if (state === null) {
        throw new Error(
            `Lot ${lotId} is closed: it was sold out, already returned, or never existed. Nothing is left to send home.`,
        );
    }
    if (lot.seller.toLowerCase() !== seller.toLowerCase()) {
        throw new Error(`Lot ${lotId} is not yours — it belongs to ${lot.seller}. Only its seller can return it.`);
    }
    if (state !== LotState.Open && state !== LotState.Evicted) {
        throw new Error(
            `Lot ${lotId} is ${state}: its escrow is still delivering to the hub. Finalize that delivery first — ` +
                `only an open or an evicted lot can be sent home.`,
        );
    }
    return state;
}

export function assertRouteStartsAtHub(chain: Array<number>, hub: bigint, lotId: string): void {
    const start = chain[0];
    if (BigInt(start as number) !== hub) {
        throw new Error(
            `The route must start at the lot's hub: lot ${lotId} sits on cell ${hub.toString()}, but the route ` +
                `starts at ${String(start)}.`,
        );
    }
}

/** A lot return is all-or-nothing; a quote for anything but the current remainder is a partial return. */
export function assertWholeRemainder(quoted: bigint, remaining: bigint, lotId: string): void {
    if (quoted !== remaining) {
        throw new Error(
            `The return quote for lot ${lotId} covers ${quoted.toString()} units but the lot holds ` +
                `${remaining.toString()}. A lot return always moves the whole remainder, so nothing was sent — ` +
                `re-read the lot and quote it again.`,
        );
    }
}

/** The ceiling travels as wei precisely so nothing rounds it; a figure that is not whole wei is not a ceiling. */
export function parseFeeCeilingWei(maxTransitFeeWei: string, lotId: string): bigint {
    if (!WEI_CEILING_PATTERN.test(maxTransitFeeWei)) {
        throw new Error(
            `The fee ceiling for lot ${lotId} must be a whole number of wei, but it reads ` +
                `"${maxTransitFeeWei}". Quote the return with cpu_quote_lot_return and pass the ` +
                `maxTransitFeeWei it answers with, unchanged — that field is already wei, not $CPU.`,
        );
    }
    return BigInt(maxTransitFeeWei);
}

/**
 * The cross-call half of the fee promise: only index 0 of a return route is capped on-chain at the fee pinned
 * when the lot was listed, so any later waypoint can raise its rate between the quote and the call. Refusing
 * here — before the allowance, before the transaction — is what keeps the quoted figure a real ceiling.
 */
export function assertFeeWithinCeiling(quotedWei: bigint, ceilingWei: bigint, lotId: string): void {
    if (quotedWei <= ceilingWei) {
        return;
    }
    throw new Error(
        `Returning lot ${lotId} now costs ${cpuFromWei(quotedWei.toString())} $CPU in transit ` +
            `(${quotedWei.toString()} wei), above the ${cpuFromWei(ceilingWei.toString())} $CPU ceiling you ` +
            `passed (${ceilingWei.toString()} wei): a fee on the route moved since that quote. Nothing was ` +
            `approved and nothing was sent. Quote the return again with cpu_quote_lot_return and send it ` +
            `straight away with the maxTransitFeeWei it answers with, or route around the cell that raised its rate.`,
    );
}

export function returnBranchOf(state: LotState): LotReturnBranch {
    return state === LotState.Evicted ? LotReturnBranch.Reclaimed : LotReturnBranch.Cancelled;
}

export function describeCapacityRefusal(
    capacity: DestinationCapacityView,
    destinationTokenId: string,
    lotId: string,
): string {
    const free = capacity.free ?? '0';
    return (
        `Cell ${destinationTokenId} cannot take the whole remainder of lot ${lotId}: it needs room for ` +
        `${capacity.required} units and only ${free} are free (what it already holds and everything reserved on ` +
        `it are counted). Nothing was approved and nothing was sent. Free the space, or pick another destination ` +
        `you own, then quote the return again.`
    );
}

export function describeLotReturnRevert(error: unknown, branch: LotReturnBranch): unknown {
    const decoded = decodeKnownRevert(error, RETURN_ERROR_ABI, LOT_RETURN_REVERT_NAMES);
    if (decoded === null) {
        return error;
    }
    return new Error(
        `This lot return did not go through: ${LOT_RETURN_REVERT_REASONS[decoded.name]}. ` +
            `The ${branch === LotReturnBranch.Reclaimed ? 'reclaim' : 'cancel'} was refused on-chain, so the lot ` +
            `and its units are untouched.`,
        { cause: error },
    );
}

/**
 * Both branches close the lot with the same lifecycle event. When a receipt carries none — a contract that
 * settles a reclaim silently — the quote the contract itself just priced is the only honest figure left, and
 * refusing to answer would report a settled return as a failure.
 */
export function decodeReturnedUnits(logs: Array<Log>, trade: Address, quoted: bigint, logger: ILogger): bigint {
    const events = parseEventLogs({ abi: TRADE_ABI, eventName: 'LotCancelled', logs });
    const event = events.find((e) => e.address.toLowerCase() === trade.toLowerCase());
    if (event === undefined) {
        logger.warn('lot return confirmed without a lifecycle event; reporting the quoted remainder', {
            quoted: quoted.toString(),
        });
        return quoted;
    }
    return event.args.returned;
}
