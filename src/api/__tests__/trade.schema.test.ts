import { describe, expect, it } from 'vitest';

import {
    apiFillViewSchema,
    apiLotViewSchema,
    apiMarketResourceSummarySchema,
    LotState,
    tradeParametersSchema,
} from '../types.js';

function lotRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        id: '7',
        hubTokenId: '5',
        sellerAddress: '0xseller',
        resourceId: 3,
        listed: '100',
        remaining: '80',
        pricePerUnit: '0.5',
        saleFeeBp: 150,
        maxSaleFeeBp: 5000,
        state: LotState.Open,
        distanceFromAnchor: null,
        createdAt: 1_700_000_000,
        updated: 1_700_000_000,
        ...overrides,
    };
}

function marketRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        hubTokenId: '5',
        resourceId: 3,
        openLots: 2,
        openRemaining: '150',
        minPricePerUnit: '0.4',
        incomingLots: 1,
        incomingRemaining: '50',
        frozenLots: 0,
        frozenRemaining: '0',
        distanceFromAnchor: null,
        ...overrides,
    };
}

describe('lot response schema', () => {
    it('accepts the evicted state as a first-class seller-owned lifecycle value', () => {
        const parsed = apiLotViewSchema.parse(lotRow({ state: 'evicted' }));

        expect(parsed.state).toBe(LotState.Evicted);
    });

    it('rejects a lifecycle value the deployed projection does not serve', () => {
        expect(() => apiLotViewSchema.parse(lotRow({ state: 'reclaimed' }))).toThrow();
    });

    it('rejects a row missing a required field instead of defaulting it away', () => {
        const { remaining: _remaining, ...withoutRemaining } = lotRow();

        expect(() => apiLotViewSchema.parse(withoutRemaining)).toThrow();
    });

    it('keeps distanceFromAnchor explicitly nullable rather than optional', () => {
        const { distanceFromAnchor: _distance, ...withoutDistance } = lotRow();

        expect(() => apiLotViewSchema.parse(withoutDistance)).toThrow();
        expect(apiLotViewSchema.parse(lotRow({ distanceFromAnchor: null })).distanceFromAnchor).toBeNull();
    });

    it('drops an unknown key rather than passing a stale shape through untouched', () => {
        const parsed = apiLotViewSchema.parse(lotRow({ legacyField: 'kept-by-passthrough' }));

        expect(parsed).not.toHaveProperty('legacyField');
    });
});

describe('market summary response schema', () => {
    it('requires the frozen aggregate the deployed projection always serves', () => {
        const { frozenLots: _lots, frozenRemaining: _remaining, ...stale } = marketRow();

        expect(() => apiMarketResourceSummarySchema.parse(stale)).toThrow();
    });

    it('rejects a null frozen aggregate, which the pre-redeploy projection used to send', () => {
        expect(() => apiMarketResourceSummarySchema.parse(marketRow({ frozenLots: null }))).toThrow();
    });

    it('parses a row carrying the frozen aggregate', () => {
        const parsed = apiMarketResourceSummarySchema.parse(marketRow({ frozenLots: 1, frozenRemaining: '40' }));

        expect(parsed.frozenLots).toBe(1);
        expect(parsed.frozenRemaining).toBe('40');
    });
});

describe('fill response schema', () => {
    it('rejects a fill row missing a required money field', () => {
        const row = {
            lotId: '7',
            blockNumber: 1200,
            logIndex: 4,
            transactionHash: '0xfill',
            hubTokenId: '5',
            resourceId: 3,
            seller: '0xseller',
            buyer: '0xbuyer',
            value: '10',
            remaining: '90',
            sale: '0.4',
            hubFee: '0.01',
            pricePerUnit: '0.04',
            settledAt: 1_700_000_000,
        };

        expect(() => apiFillViewSchema.parse(row)).toThrow();
    });
});

describe('trade parameters schema', () => {
    it('requires the sale burn and the sale-fee ceiling', () => {
        expect(() => tradeParametersSchema.parse({ maxSaleFeeBp: 5000 })).toThrow(/saleBurnPercent/);
        expect(() => tradeParametersSchema.parse({ saleBurnPercent: 1 })).toThrow(/maxSaleFeeBp/);
    });

    it('keeps only the two parameters, so an unknown key cannot travel with them', () => {
        const parsed = tradeParametersSchema.parse({ saleBurnPercent: 1, maxSaleFeeBp: 5000, minLotValue: '1000' });

        expect(parsed).toEqual({ saleBurnPercent: 1, maxSaleFeeBp: 5000 });
    });
});
