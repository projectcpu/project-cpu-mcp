import { describe, expect, it } from 'vitest';

import type { PrepareOfferResponse } from '../offer.types.js';
import {
    effectiveOfferDeadline,
    isEquivalentActiveOffer,
    offerActionInputs,
    orderCurrencyConsiderationTotal,
} from '../offer.utils.js';
import { MarketOfferKind, type MarketOffer, type SeaportOrderParameters } from '../types.js';

const WALLET = `0x${'1'.repeat(40)}`;

const CURRENCY = `0x${'3'.repeat(40)}`;

const REQUEST = { tokenId: '1234', amount: '1000', expirationTime: 1_800_086_400 };

function activeOffer(over: Partial<MarketOffer> = {}): MarketOffer {
    return {
        orderHash: `0x${'f'.repeat(64)}`,
        protocolAddress: `0x${'2'.repeat(40)}`,
        chainId: 42161,
        maker: WALLET,
        kind: MarketOfferKind.Item,
        tokenId: '1234',
        amount: '1000',
        currency: { address: CURRENCY, symbol: 'WETH', decimals: 18 },
        startTime: 1_800_000_000,
        expirationTime: 1_800_086_400,
        ...over,
    };
}

describe('the identity of one offer intent', () => {
    it('is built from the Cell, the amount and the expiry the agent asked for', () => {
        expect(offerActionInputs(REQUEST)).toEqual(['1234', '1000', '1800086400']);
    });

    it('stops at the earlier of the prepared deadline and the offer expiry', () => {
        const soonestIntent = { expiresAt: 500, offer: { expirationTime: 900 } } as PrepareOfferResponse;
        const soonestOffer = { expiresAt: 900, offer: { expirationTime: 500 } } as PrepareOfferResponse;

        expect(effectiveOfferDeadline(soonestIntent)).toBe(500);
        expect(effectiveOfferDeadline(soonestOffer)).toBe(500);
    });
});

describe('an active offer that would duplicate this intent', () => {
    it('matches an item offer of this wallet on the same Cell, amount and expiry', () => {
        expect(isEquivalentActiveOffer(activeOffer(), REQUEST, WALLET, null)).toBe(true);
    });

    it.each([
        ['another maker', { maker: `0x${'8'.repeat(40)}` }],
        ['another Cell', { tokenId: '77' }],
        ['another amount', { amount: '999' }],
        ['another expiry', { expirationTime: 1_800_086_401 }],
        ['a collection offer', { kind: MarketOfferKind.Collection, tokenId: null }],
        ['a trait offer', { kind: MarketOfferKind.Trait, tokenId: null }],
    ])('does not match %s', (_label, over) => {
        expect(isEquivalentActiveOffer(activeOffer(over), REQUEST, WALLET, null)).toBe(false);
    });

    it('does not match the same price in a different currency once the currency is known', () => {
        const other = activeOffer({ currency: { address: `0x${'9'.repeat(40)}`, symbol: 'USDC', decimals: 6 } });

        expect(isEquivalentActiveOffer(other, REQUEST, WALLET, CURRENCY)).toBe(false);
        expect(isEquivalentActiveOffer(activeOffer(), REQUEST, WALLET, CURRENCY)).toBe(true);
    });

    it('compares the maker address regardless of its letter case', () => {
        expect(isEquivalentActiveOffer(activeOffer({ maker: WALLET.toUpperCase() }), REQUEST, WALLET, null)).toBe(true);
    });
});

describe('what an order pays out of the amount offered', () => {
    it('adds up only the currency items, never the Cell it asks for', () => {
        const order = {
            consideration: [
                { itemType: 2, token: `0x${'5'.repeat(40)}`, startAmount: '1', endAmount: '1' },
                { itemType: 1, token: CURRENCY, startAmount: '25', endAmount: '25' },
                { itemType: 1, token: CURRENCY, startAmount: '50', endAmount: '50' },
            ],
        } as unknown as SeaportOrderParameters;

        expect(orderCurrencyConsiderationTotal(order, CURRENCY)).toBe('75');
    });
});
