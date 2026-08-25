import { type Abi } from 'viem';

import { QUOTE_REVERT_REASONS } from './trade.constants.js';
import {
    type ApiLotView,
    type ApiMarketIndex,
    type ApiMarketResourceSummary,
    type LotView,
    type MarketIndex,
    type MarketResourceSummary,
    LotState,
} from '../api/types.js';
import { TRADE_ABI } from '../contracts/trade.abi.js';
import { OnChainLotState } from '../contracts/trade.types.js';
import { TRANSPORT_ABI } from '../contracts/transport.abi.js';
import { bpToPercent } from '../utils/format.utils.js';
import { describeRevert } from '../wallet/revert.utils.js';

const QUOTE_ERROR_ABI = [...TRADE_ABI, ...TRANSPORT_ABI] as unknown as Abi;

export function namedQuoteRevert(error: unknown): unknown {
    const revert = describeRevert(error, QUOTE_ERROR_ABI);
    if (revert === null) {
        return error;
    }
    return new Error(`Quote reverted: ${revert}`, { cause: error });
}

/**
 * The two boundaries name the lifecycle differently and neither is a superset of the other: the contract
 * deletes a lot once it is sold out, cancelled or reclaimed, so its terminal ordinal is the empty slot,
 * while the projection keeps naming which terminal state it reached.
 */
export function lotStateFromChain(state: OnChainLotState): LotState | null {
    switch (state) {
        case OnChainLotState.Delivering:
            return LotState.Delivering;
        case OnChainLotState.Open:
            return LotState.Open;
        case OnChainLotState.Evicted:
            return LotState.Evicted;
        case OnChainLotState.None:
            return null;
    }
}

export function lotStateToChain(state: LotState): OnChainLotState {
    switch (state) {
        case LotState.Delivering:
            return OnChainLotState.Delivering;
        case LotState.Open:
            return OnChainLotState.Open;
        case LotState.Evicted:
            return OnChainLotState.Evicted;
        case LotState.Sold:
        case LotState.Cancelled:
            return OnChainLotState.None;
    }
}

export function toLotView(lot: ApiLotView): LotView {
    return {
        id: lot.id,
        hubTokenId: lot.hubTokenId,
        sellerAddress: lot.sellerAddress,
        resourceId: lot.resourceId,
        listed: lot.listed,
        remaining: lot.remaining,
        pricePerUnit: lot.pricePerUnit,
        saleFeePercent: bpToPercent(lot.saleFeeBp),
        maxSaleFeePercent: bpToPercent(lot.maxSaleFeeBp),
        // Only an Open lot can freeze: freezing means a buy would revert, and nothing else is buyable.
        frozen: lot.state === LotState.Open && lot.saleFeeBp > lot.maxSaleFeeBp,
        state: lot.state,
        distanceFromAnchor: lot.distanceFromAnchor,
        createdAt: lot.createdAt,
        updated: lot.updated,
    };
}

export function toMarketIndex(index: ApiMarketIndex): MarketIndex {
    return {
        computedAt: index.computedAt,
        resources: index.resources.map((row) => ({ ...row })),
    };
}

export function toMarketResourceSummary(row: ApiMarketResourceSummary): MarketResourceSummary {
    return {
        hubTokenId: row.hubTokenId,
        resourceId: row.resourceId,
        openLots: row.openLots,
        openRemaining: row.openRemaining,
        minPricePerUnit: row.minPricePerUnit,
        incomingLots: row.incomingLots,
        incomingRemaining: row.incomingRemaining,
        frozenLots: row.frozenLots,
        frozenRemaining: row.frozenRemaining,
        distanceFromAnchor: row.distanceFromAnchor,
    };
}

export function enrichSaleFeeToleranceError(error: unknown): unknown {
    if (error instanceof Error && error.message.includes('SaleFeeExceedsMax')) {
        return new Error(
            `${error.message} — the hub's live sale fee now exceeds your tolerance (maxSaleFeePercent), which ` +
                `would list an already-frozen lot (buys revert until the hub lowers the rate to the tolerance or ` +
                `below; a lot return owes no sale fee, but still pays transit for the route home). Re-read the ` +
                `hub's current rate (cpu_get_cell or ` +
                `cpu_get_markets), then retry with a higher maxSaleFeePercent, or omit it to accept the current rate.`,
            { cause: error },
        );
    }
    return error;
}

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
                `send the remainder home at any time, paying no sale fee but still paying transit for the route.`,
            { cause: error },
        );
    }
    return error;
}
