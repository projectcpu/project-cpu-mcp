import { type Abi } from 'viem';

import type { ApiLotView, ApiMarketResourceSummary, LotView, MarketResourceSummary } from '../api/types.js';
import { TRADE_ABI } from '../contracts/trade.abi.js';
import { TRANSPORT_ABI } from '../contracts/transport.abi.js';
import { bpToPercent, cpuFromWei } from '../utils/format.utils.js';
import { describeRevert } from '../wallet/revert.utils.js';

const QUOTE_ERROR_ABI = [...TRADE_ABI, ...TRANSPORT_ABI] as unknown as Abi;

export function namedQuoteRevert(error: unknown): unknown {
    const revert = describeRevert(error, QUOTE_ERROR_ABI);
    if (revert === null) {
        return error;
    }
    return new Error(`Quote reverted: ${revert}`, { cause: error });
}

export function withDecimalPrice(lot: ApiLotView): LotView {
    return {
        id: lot.id,
        hubTokenId: lot.hubTokenId,
        sellerAddress: lot.sellerAddress,
        resourceId: lot.resourceId,
        listed: lot.listed,
        remaining: lot.remaining,
        pricePerUnit: cpuFromWei(lot.pricePerUnit),
        saleFeePercent: bpToPercent(lot.saleFeeBp),
        maxSaleFeePercent: bpToPercent(lot.maxSaleFeeBp),
        frozen: lot.saleFeeBp > lot.maxSaleFeeBp,
        state: lot.state,
        distanceFromAnchor: lot.distanceFromAnchor,
        createdAt: lot.createdAt,
        updated: lot.updated,
    };
}

export function withDecimalMinPrice(row: ApiMarketResourceSummary): MarketResourceSummary {
    return {
        hubTokenId: row.hubTokenId,
        resourceId: row.resourceId,
        openLots: row.openLots,
        openRemaining: row.openRemaining,
        minPricePerUnit: row.minPricePerUnit === null ? null : cpuFromWei(row.minPricePerUnit),
        incomingLots: row.incomingLots,
        incomingRemaining: row.incomingRemaining,
        frozenLots: row.frozenLots ?? null,
        frozenRemaining: row.frozenRemaining ?? null,
        distanceFromAnchor: row.distanceFromAnchor,
    };
}

export function enrichSaleFeeToleranceError(error: unknown): unknown {
    if (error instanceof Error && error.message.includes('SaleFeeExceedsMax')) {
        return new Error(
            `${error.message} — the hub's live sale fee now exceeds your tolerance (maxSaleFeePercent), which ` +
                `would list an already-frozen lot (buys revert until the hub lowers the rate to the tolerance or ` +
                `below, though cancel stays fee-free). Re-read the hub's current rate (cpu_get_cell or ` +
                `cpu_get_markets), then retry with a higher maxSaleFeePercent, or omit it to accept the current rate.`,
            { cause: error },
        );
    }
    return error;
}

const QUOTE_REVERT_REASONS: ReadonlyArray<{ name: string; reason: string }> = [
    { name: 'LotNotOpen', reason: 'the lot is closed — sold out, still delivering, or cancelled' },
    { name: 'ExceedsRemaining', reason: "the amount exceeds the lot's remaining units" },
    { name: 'InvalidValue', reason: 'the buy amount must be greater than zero' },
    {
        name: 'SaleFeeExceedsMax',
        reason:
            "the lot is frozen: the hub's live sale fee now exceeds the seller's tolerance, so the buy reverts " +
            'until the hub lowers the rate (or the seller cancels, fee-free)',
    },
    { name: 'WrongHub', reason: "the route must start at the lot's hub" },
    { name: 'NotDestOwner', reason: 'the destination cell (route end) must be one you own' },
    { name: 'PathTooShort', reason: 'the route needs at least the hub and your destination cell' },
    {
        name: 'NotEligibleWaypoint',
        reason: 'a waypoint on the route is not eligible — a foreign frozen hub blocks the path',
    },
    { name: 'HopOutOfRange', reason: "a hop on the route is longer than transport's reach" },
    { name: 'NotWaypointOwner', reason: 'a non-hub waypoint on the route is not owned by you' },
    { name: 'DegenerateWaypoint', reason: 'the route repeats a waypoint' },
    { name: 'NotRevealed', reason: 'a cell on the route (or the hub) is not revealed yet' },
    { name: 'BelowMinAmount', reason: "the amount is below transport's minimum" },
];

export function enrichBuyQuoteRevert(error: unknown): unknown {
    if (!(error instanceof Error) || !error.message.includes('Quote reverted:')) {
        return error;
    }
    const match = QUOTE_REVERT_REASONS.find((entry) => error.message.includes(entry.name));
    const reason = match !== undefined ? match.reason : error.message;
    return new Error(
        `This purchase won't go through: ${reason}. (A quote does not check pause, $CPU balance, or ` +
            `allowance — those can still block a fill.)`,
        { cause: error },
    );
}

export function enrichFrozenBuyError(error: unknown): unknown {
    if (error instanceof Error && error.message.includes('SaleFeeExceedsMax')) {
        return new Error(
            `${error.message} — this lot is frozen: the hub's live sale fee now exceeds the seller's tolerance ` +
                `(maxSaleFeePercent), so the buy reverts. Wait for the hub owner to lower the rate to the tolerance ` +
                `or below (re-check with cpu_get_lot or cpu_get_markets), or pick another lot; the seller can ` +
                `cancel the lot fee-free at any time.`,
            { cause: error },
        );
    }
    return error;
}
