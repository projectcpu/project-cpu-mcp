import { describe, expect, it } from 'vitest';

import type { PrepareAcceptanceResponse } from '../acceptance.types.js';
import {
    acceptanceActionInputs,
    acceptanceApprovals,
    acceptanceFulfilment,
    effectiveAcceptanceDeadline,
} from '../acceptance.utils.js';
import { MarketOfferKind, MarketTransactionKind, type MarketTransaction } from '../types.js';

const ORDER_HASH = `0x${'e'.repeat(64)}`;

function transaction(kind: MarketTransactionKind, data: string): MarketTransaction {
    return { kind, to: `0x${'1'.repeat(40)}`, data, value: '0', chainId: 42161 };
}

function prepared(over: Partial<PrepareAcceptanceResponse> = {}): PrepareAcceptanceResponse {
    return {
        transactions: [],
        offer: {
            orderHash: ORDER_HASH,
            protocolAddress: `0x${'2'.repeat(40)}`,
            chainId: 42161,
            maker: `0x${'3'.repeat(40)}`,
            kind: MarketOfferKind.Item,
            tokenId: '1234',
            amount: '5',
            currency: { address: `0x${'4'.repeat(40)}`, symbol: 'WETH', decimals: 18 },
            startTime: 0,
            expirationTime: 2_000,
        },
        ...over,
    };
}

describe('the acceptance intent identity', () => {
    it('keeps one identity per order and bound Cell, case-insensitively for the hash', () => {
        expect(acceptanceActionInputs({ orderHash: ORDER_HASH.toUpperCase(), tokenId: '1234' })).toEqual([
            ORDER_HASH,
            '1234',
        ]);
    });

    it('keeps an unbound item acceptance distinct from a bound one', () => {
        expect(acceptanceActionInputs({ orderHash: ORDER_HASH, tokenId: null })).toEqual([ORDER_HASH, null]);
    });
});

describe('the acceptance deadline', () => {
    it('uses the offer expiry because the canonical response has no separate prepared-intent deadline', () => {
        expect(effectiveAcceptanceDeadline(prepared())).toBe(2_000);
    });

    it('tracks an earlier offer expiry', () => {
        const initial = prepared();
        expect(effectiveAcceptanceDeadline(prepared({ offer: { ...initial.offer, expirationTime: 500 } }))).toBe(500);
    });
});

describe('the acceptance transactions', () => {
    it('separates the collection approvals from the one fulfilment', () => {
        const transactions = [
            transaction(MarketTransactionKind.CollectionApproval, '0xa1'),
            transaction(MarketTransactionKind.Fulfillment, '0xf1'),
        ];

        const intent = prepared({ transactions });

        expect(acceptanceApprovals(intent).map((tx) => tx.data)).toEqual(['0xa1']);
        expect(acceptanceFulfilment(intent)?.data).toBe('0xf1');
    });

    it('refuses to name a fulfilment when more than one is offered', () => {
        const transactions = [
            transaction(MarketTransactionKind.Fulfillment, '0xf1'),
            transaction(MarketTransactionKind.Fulfillment, '0xf2'),
        ];

        expect(acceptanceFulfilment(prepared({ transactions }))).toBeNull();
    });

    it('refuses to name a fulfilment when none is offered', () => {
        expect(acceptanceFulfilment(prepared())).toBeNull();
    });
});
