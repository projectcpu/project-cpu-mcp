import { describe, expect, it } from 'vitest';

import { type ApiLotView, type ApiMarketResourceSummary, LotState } from '../../api/types.js';
import { OnChainLotState } from '../../contracts/trade.types.js';
import { lotStateFromChain, lotStateToChain, toLotView, toMarketResourceSummary } from '../trade.helpers.js';

function apiLot(overrides: Partial<ApiLotView> = {}): ApiLotView {
    return {
        id: '7',
        hubTokenId: '5',
        sellerAddress: '0xseller',
        resourceId: 3,
        listed: '100',
        remaining: '80',
        pricePerUnit: '0.5',
        saleFeeBp: 600,
        maxSaleFeeBp: 500,
        state: LotState.Open,
        distanceFromAnchor: null,
        createdAt: 1_700_000_000,
        updated: 1_700_000_000,
        ...overrides,
    };
}

describe('lot state mapping between the two boundaries', () => {
    it('maps the deployed evicted ordinal to the named HTTP state', () => {
        expect(lotStateFromChain(OnChainLotState.Evicted)).toBe(LotState.Evicted);
    });

    it('maps the live ordinals it can name and answers null for a lot the contract no longer holds', () => {
        expect(lotStateFromChain(OnChainLotState.Delivering)).toBe(LotState.Delivering);
        expect(lotStateFromChain(OnChainLotState.Open)).toBe(LotState.Open);
        expect(lotStateFromChain(OnChainLotState.None)).toBeNull();
    });

    it('maps the named states back to their ordinals, terminal ones landing on the empty slot', () => {
        expect(lotStateToChain(LotState.Evicted)).toBe(OnChainLotState.Evicted);
        expect(lotStateToChain(LotState.Open)).toBe(OnChainLotState.Open);
        expect(lotStateToChain(LotState.Delivering)).toBe(OnChainLotState.Delivering);
        expect(lotStateToChain(LotState.Sold)).toBe(OnChainLotState.None);
        expect(lotStateToChain(LotState.Cancelled)).toBe(OnChainLotState.None);
    });

    it('keeps the ordinals the contract deployed, so a shifted enum cannot pass', () => {
        expect(OnChainLotState.None).toBe(0);
        expect(OnChainLotState.Delivering).toBe(1);
        expect(OnChainLotState.Open).toBe(2);
        expect(OnChainLotState.Evicted).toBe(3);
    });
});

describe('lot projection', () => {
    it('freezes an open lot whose live rate passed the seller tolerance', () => {
        expect(toLotView(apiLot()).frozen).toBe(true);
    });

    it('never freezes an evicted lot, whose sale fee no longer decides anything', () => {
        expect(toLotView(apiLot({ state: LotState.Evicted })).frozen).toBe(false);
    });

    it('never freezes a delivering lot, which is not on sale yet', () => {
        expect(toLotView(apiLot({ state: LotState.Delivering })).frozen).toBe(false);
    });

    it('leaves an open lot inside its tolerance unfrozen', () => {
        expect(toLotView(apiLot({ saleFeeBp: 100 })).frozen).toBe(false);
    });
});

describe('market summary projection', () => {
    it('carries the frozen aggregate through as the numbers the projection served', () => {
        const row: ApiMarketResourceSummary = {
            hubTokenId: '5',
            resourceId: 3,
            openLots: 2,
            openRemaining: '150',
            minPricePerUnit: '0.4',
            incomingLots: 1,
            incomingRemaining: '50',
            frozenLots: 3,
            frozenRemaining: '40',
            distanceFromAnchor: null,
        };

        const view = toMarketResourceSummary(row);

        expect(view.frozenLots).toBe(3);
        expect(view.frozenRemaining).toBe('40');
    });
});
