import {
    concat,
    encodeAbiParameters,
    encodeFunctionData,
    keccak256,
    toHex,
    zeroAddress,
    type Abi,
    type Hex,
} from 'viem';
import { describe, expect, it } from 'vitest';

import { SEAPORT_ORDER_COMPONENTS_TYPES } from '../../../contracts/seaport.constants.js';
import { SEAPORT_CANCEL_ABI } from '../cancel.abi.js';
import {
    cancellationActionInputs,
    cancellationTransaction,
    cancelledOrders,
    seaportOrderHash,
} from '../cancel.utils.js';
import { MarketOrderKind, MarketTransactionKind, type MarketTransaction } from '../types.js';

const MAKER = `0x${'1'.repeat(40)}`;

const COLLECTION = `0x${'5'.repeat(40)}`;

const SEAPORT_ORDER_TYPEHASH = '0xfa445660b7e21515a59617fcd68910b487aa5808b8abda3d78bc85df364b2c2f';

function components(salt: bigint = 9n, offerer: string = MAKER): Record<string, unknown> {
    return {
        offerer,
        zone: zeroAddress,
        offer: [{ itemType: 2, token: COLLECTION, identifierOrCriteria: 1234n, startAmount: 1n, endAmount: 1n }],
        consideration: [
            {
                itemType: 0,
                token: zeroAddress,
                identifierOrCriteria: 0n,
                startAmount: 1000n,
                endAmount: 1000n,
                recipient: offerer,
            },
        ],
        orderType: 0,
        startTime: 1n,
        endTime: 2n,
        zoneHash: `0x${'0'.repeat(64)}`,
        salt,
        conduitKey: `0x${'7'.repeat(64)}`,
        counter: 0n,
    };
}

function cancelCalldata(orders: Array<Record<string, unknown>>): Hex {
    return encodeFunctionData({ abi: SEAPORT_CANCEL_ABI as unknown as Abi, functionName: 'cancel', args: [orders] });
}

function encodeType(): string {
    const struct = (name: string): string => {
        const fields = SEAPORT_ORDER_COMPONENTS_TYPES[name as keyof typeof SEAPORT_ORDER_COMPONENTS_TYPES];
        return `${name}(${fields.map((field) => `${field.type} ${field.name}`).join(',')})`;
    };

    return [struct('OrderComponents'), struct('ConsiderationItem'), struct('OfferItem')].join('');
}

const OFFER_ITEM_TYPEHASH = keccak256(
    toHex('OfferItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,uint256 endAmount)'),
);

const CONSIDERATION_ITEM_TYPEHASH = keccak256(
    toHex(
        'ConsiderationItem(uint8 itemType,address token,uint256 identifierOrCriteria,uint256 startAmount,' +
            'uint256 endAmount,address recipient)',
    ),
);

/**
 * The order hash rebuilt by hand from the published struct definitions — no shared helper and no shared
 * type table. It is the only independent witness that the hash covers every field the protocol hashes;
 * every other expectation in this file is computed with the function under test.
 */
function orderHashByHand(order: Record<string, unknown>): Hex {
    const offered = (order.offer as Array<Record<string, unknown>>).map((item) =>
        keccak256(
            encodeAbiParameters(
                [
                    { type: 'bytes32' },
                    { type: 'uint256' },
                    { type: 'address' },
                    { type: 'uint256' },
                    { type: 'uint256' },
                    { type: 'uint256' },
                ],
                [
                    OFFER_ITEM_TYPEHASH,
                    BigInt(item.itemType as number),
                    item.token as Hex,
                    item.identifierOrCriteria as bigint,
                    item.startAmount as bigint,
                    item.endAmount as bigint,
                ],
            ),
        ),
    );
    const paid = (order.consideration as Array<Record<string, unknown>>).map((item) =>
        keccak256(
            encodeAbiParameters(
                [
                    { type: 'bytes32' },
                    { type: 'uint256' },
                    { type: 'address' },
                    { type: 'uint256' },
                    { type: 'uint256' },
                    { type: 'uint256' },
                    { type: 'address' },
                ],
                [
                    CONSIDERATION_ITEM_TYPEHASH,
                    BigInt(item.itemType as number),
                    item.token as Hex,
                    item.identifierOrCriteria as bigint,
                    item.startAmount as bigint,
                    item.endAmount as bigint,
                    item.recipient as Hex,
                ],
            ),
        ),
    );

    return keccak256(
        encodeAbiParameters(
            [
                { type: 'bytes32' },
                { type: 'address' },
                { type: 'address' },
                { type: 'bytes32' },
                { type: 'bytes32' },
                { type: 'uint256' },
                { type: 'uint256' },
                { type: 'uint256' },
                { type: 'bytes32' },
                { type: 'uint256' },
                { type: 'bytes32' },
                { type: 'uint256' },
            ],
            [
                SEAPORT_ORDER_TYPEHASH,
                order.offerer as Hex,
                order.zone as Hex,
                keccak256(concat(offered)),
                keccak256(concat(paid)),
                BigInt(order.orderType as number),
                order.startTime as bigint,
                order.endTime as bigint,
                order.zoneHash as Hex,
                order.salt as bigint,
                order.conduitKey as Hex,
                order.counter as bigint,
            ],
        ),
    );
}

describe('reading a prepared cancellation from its own bytes', () => {
    it('hashes the order struct exactly as the protocol contract does', () => {
        expect(keccak256(toHex(encodeType()))).toBe(SEAPORT_ORDER_TYPEHASH);
    });

    it('produces the hash the published struct definitions produce, field for field', () => {
        expect(seaportOrderHash(components())).toBe(orderHashByHand(components()));
    });

    it('moves when a hashed field moves, the order counter included', () => {
        const bumped = { ...components(), counter: 1n };

        expect(seaportOrderHash(bumped)).toBe(orderHashByHand(bumped));
        expect(seaportOrderHash(bumped)).not.toBe(seaportOrderHash(components()));
    });

    it('names the maker and the order hash of the single order it cancels', () => {
        const order = components();

        const decoded = cancelledOrders(cancelCalldata([order]));

        expect(decoded).toEqual([
            {
                offerer: MAKER,
                orderHash: seaportOrderHash(order),
                kind: MarketOrderKind.Listing,
                tokenId: '1234',
            },
        ]);
    });

    it('gives a different order hash for a different order of the same maker', () => {
        const first = cancelledOrders(cancelCalldata([components(9n)]));
        const second = cancelledOrders(cancelCalldata([components(77n)]));

        expect(first?.[0]?.orderHash).not.toBe(second?.[0]?.orderHash);
    });

    it('reports every order the calldata would cancel', () => {
        const decoded = cancelledOrders(cancelCalldata([components(9n), components(77n)]));

        expect(decoded).toHaveLength(2);
    });

    it.each([
        ['empty calldata', '0x'],
        ['an unknown function', '0xdeadbeef'],
        ['a bare cancellation selector with no arguments', '0xfd9f1e10'],
    ])('reads nothing out of %s', (_label, data) => {
        expect(cancelledOrders(data)).toBeNull();
    });
});

describe('the one transaction a cancellation may send', () => {
    function transaction(over: Partial<MarketTransaction> = {}): MarketTransaction {
        return {
            kind: MarketTransactionKind.Cancellation,
            to: COLLECTION,
            data: '0xfd9f1e10',
            value: '0',
            chainId: 42161,
            ...over,
        };
    }

    it('finds the single cancellation transaction', () => {
        expect(cancellationTransaction([transaction()])).toEqual(transaction());
    });

    it('refuses an empty sequence, a second cancellation, or another kind', () => {
        expect(cancellationTransaction([])).toBeNull();
        expect(cancellationTransaction([transaction(), transaction()])).toBeNull();
        expect(cancellationTransaction([transaction({ kind: MarketTransactionKind.Fulfillment })])).toBeNull();
    });
});

describe('the identity of one cancellation intent', () => {
    it('is the order hash alone, in a stable case', () => {
        expect(cancellationActionInputs({ orderHash: '0xABCDEF' })).toEqual(['0xabcdef']);
    });
});
