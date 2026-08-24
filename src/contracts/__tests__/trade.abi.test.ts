import {
    decodeErrorResult,
    decodeEventLog,
    decodeFunctionData,
    decodeFunctionResult,
    encodeAbiParameters,
    encodeErrorResult,
    encodeEventTopics,
    encodeFunctionData,
    encodeFunctionResult,
    type Address,
    type Hex,
} from 'viem';
import { describe, expect, it } from 'vitest';

import { TRADE_ABI } from '../trade.abi.js';
import { OnChainLotState } from '../trade.types.js';

const SELLER = '0x00000000000000000000000000000000000000A1' as Address;
const EVICTOR = '0x00000000000000000000000000000000000000b2' as Address;

function topicsOf(topics: unknown): [Hex, ...Array<Hex>] {
    return topics as [Hex, ...Array<Hex>];
}

describe('TRADE_ABI lot layout', () => {
    it('decodes the deployed Lot tuple in its exact field order, routing snapshots included', () => {
        const encoded = encodeFunctionResult({
            abi: TRADE_ABI,
            functionName: 'getLot',
            result: {
                seller: SELLER,
                hub: 5n,
                resource: 3,
                remaining: 80n,
                pricePerUnit: 500_000_000_000_000_000n,
                state: OnChainLotState.Evicted,
                maxSaleFeeBp: 250,
                hubRadius: 5,
                hubMoveFee: 42n,
            },
        });

        const decoded = decodeFunctionResult({ abi: TRADE_ABI, functionName: 'getLot', data: encoded });

        expect(decoded).toEqual({
            seller: SELLER,
            hub: 5n,
            resource: 3,
            remaining: 80n,
            pricePerUnit: 500_000_000_000_000_000n,
            state: OnChainLotState.Evicted,
            maxSaleFeeBp: 250,
            hubRadius: 5,
            hubMoveFee: 42n,
        });
    });

    it('refuses the pre-redeploy Lot layout, which ended at maxSaleFeeBp', () => {
        const stale = encodeAbiParameters(
            [
                {
                    type: 'tuple',
                    components: [
                        { type: 'address' },
                        { type: 'uint256' },
                        { type: 'uint16' },
                        { type: 'uint128' },
                        { type: 'uint128' },
                        { type: 'uint8' },
                        { type: 'uint16' },
                    ],
                },
            ],
            [[SELLER, 5n, 3, 80n, 1n, 2, 250]],
        );

        expect(() => decodeFunctionResult({ abi: TRADE_ABI, functionName: 'getLot', data: stale })).toThrow();
    });

    it('decodes a batch lot read as an array of the same tuple', () => {
        const encoded = encodeFunctionResult({
            abi: TRADE_ABI,
            functionName: 'getLots',
            result: [
                {
                    seller: SELLER,
                    hub: 5n,
                    resource: 3,
                    remaining: 80n,
                    pricePerUnit: 1n,
                    state: OnChainLotState.Open,
                    maxSaleFeeBp: 250,
                    hubRadius: 5,
                    hubMoveFee: 0n,
                },
            ],
        });

        const decoded = decodeFunctionResult({ abi: TRADE_ABI, functionName: 'getLots', data: encoded });

        expect(decoded).toHaveLength(1);
        expect(decoded[0]?.hubMoveFee).toBe(0n);
    });
});

describe('TRADE_ABI configuration layout', () => {
    it('decodes the deployed TradeConfig tuple in its exact field order', () => {
        const encoded = encodeFunctionResult({
            abi: TRADE_ABI,
            functionName: 'getConfig',
            result: {
                minPricePerUnit: 0n,
                saleBurnPercent: 1,
                minLotShareBp: 10,
                maxLotShareBp: 200,
                maxLotsPerSellerResource: 5,
                minUncappedLotValue: 10_000n,
                maxUncappedLotValue: 100_000n,
            },
        });

        const decoded = decodeFunctionResult({ abi: TRADE_ABI, functionName: 'getConfig', data: encoded });

        expect(decoded).toEqual({
            minPricePerUnit: 0n,
            saleBurnPercent: 1,
            minLotShareBp: 10,
            maxLotShareBp: 200,
            maxLotsPerSellerResource: 5,
            minUncappedLotValue: 10_000n,
            maxUncappedLotValue: 100_000n,
        });
    });

    it('refuses the pre-redeploy TradeConfig, which carried a flat minimum lot value', () => {
        const stale = encodeAbiParameters(
            [
                {
                    type: 'tuple',
                    components: [{ type: 'uint128' }, { type: 'uint128' }, { type: 'uint16' }],
                },
            ],
            [[0n, 1_000n, 1]],
        );

        expect(() => decodeFunctionResult({ abi: TRADE_ABI, functionName: 'getConfig', data: stale })).toThrow();
    });
});

describe('TRADE_ABI eviction and return surface', () => {
    it('encodes an eviction as the single lot it acts on', () => {
        const data = encodeFunctionData({ abi: TRADE_ABI, functionName: 'evict', args: [7n] });

        expect(decodeFunctionData({ abi: TRADE_ABI, data })).toEqual({ functionName: 'evict', args: [7n] });
    });

    it('encodes a reclaim with the lot, the explicit return chain and the maximum transit fee', () => {
        const data = encodeFunctionData({
            abi: TRADE_ABI,
            functionName: 'reclaim',
            args: [7n, [5n, 6n], 900n],
        });

        expect(decodeFunctionData({ abi: TRADE_ABI, data })).toEqual({
            functionName: 'reclaim',
            args: [7n, [5n, 6n], 900n],
        });
    });

    it('decodes the return quote tuple in its exact field order', () => {
        const encoded = encodeFunctionResult({
            abi: TRADE_ABI,
            functionName: 'quoteReturn',
            result: {
                transitFee: 900n,
                transitDiscount: 100n,
                totalDistance: 4n,
                arrivalAt: 1_700_000_000n,
                amount: 80n,
            },
        });

        const decoded = decodeFunctionResult({ abi: TRADE_ABI, functionName: 'quoteReturn', data: encoded });

        expect(decoded).toEqual({
            transitFee: 900n,
            transitDiscount: 100n,
            totalDistance: 4n,
            arrivalAt: 1_700_000_000n,
            amount: 80n,
        });
    });

    it('decodes the eviction event with the evictor and the seller both indexed', () => {
        const topics = encodeEventTopics({
            abi: TRADE_ABI,
            eventName: 'LotEvicted',
            args: { lotId: 7n, evictor: EVICTOR, seller: SELLER },
        });
        const data = encodeAbiParameters([{ type: 'uint128' }], [80n]);

        const decoded = decodeEventLog({ abi: TRADE_ABI, topics: topicsOf(topics), data });

        expect(decoded.eventName).toBe('LotEvicted');
        expect(decoded.args).toEqual({ lotId: 7n, evictor: EVICTOR, seller: SELLER, remaining: 80n });
    });
});

describe('TRADE_ABI bound and count reads', () => {
    it('encodes the effective bounds as a hub and resource pair', () => {
        const min = encodeFunctionData({ abi: TRADE_ABI, functionName: 'getMinLotValue', args: [5n, 3] });
        const max = encodeFunctionData({ abi: TRADE_ABI, functionName: 'getMaxLotValue', args: [5n, 3] });

        expect(decodeFunctionData({ abi: TRADE_ABI, data: min })).toEqual({
            functionName: 'getMinLotValue',
            args: [5n, 3],
        });
        expect(decodeFunctionData({ abi: TRADE_ABI, data: max })).toEqual({
            functionName: 'getMaxLotValue',
            args: [5n, 3],
        });
    });

    it('keys the live-lot count by seller, hub and resource, and the evicted count by seller and hub', () => {
        const lots = encodeFunctionData({
            abi: TRADE_ABI,
            functionName: 'getSellerLotCount',
            args: [SELLER, 5n, 3],
        });
        const evicted = encodeFunctionData({
            abi: TRADE_ABI,
            functionName: 'getSellerEvictedCount',
            args: [SELLER, 5n],
        });

        expect(decodeFunctionData({ abi: TRADE_ABI, data: lots })).toEqual({
            functionName: 'getSellerLotCount',
            args: [SELLER, 5n, 3],
        });
        expect(decodeFunctionData({ abi: TRADE_ABI, data: evicted })).toEqual({
            functionName: 'getSellerEvictedCount',
            args: [SELLER, 5n],
        });
    });
});

describe('TRADE_ABI revert selectors', () => {
    const NEW_ERRORS = [
        'EvictedLotPending',
        'LotNotEvicted',
        'SelfEviction',
        'TooManyLots',
        'LotTooLarge',
        'LotShareTooHigh',
        'EmptyLotWindow',
    ] as const;

    it.each(NEW_ERRORS)('decodes %s back to its name', (errorName) => {
        const data = encodeErrorResult({ abi: TRADE_ABI, errorName });

        expect(decodeErrorResult({ abi: TRADE_ABI, data }).errorName).toBe(errorName);
    });

    it('keeps the lifecycle, ownership, amount and storage selectors the writes still raise', () => {
        const kept = [
            'LotNotOpen',
            'NotSeller',
            'NotHubOwner',
            'ExceedsRemaining',
            'NotDestOwner',
            'WrongHub',
        ] as const;

        for (const errorName of kept) {
            const data = encodeErrorResult({ abi: TRADE_ABI, errorName });
            expect(decodeErrorResult({ abi: TRADE_ABI, data }).errorName).toBe(errorName);
        }
    });
});
