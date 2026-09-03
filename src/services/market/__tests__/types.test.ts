import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
    baseUnitAmountSchema,
    bytes32Schema,
    cellTokenIdSchema,
    chainIdSchema,
    cursorSchema,
    evmAddressSchema,
    hexDataSchema,
    marketCurrencySchema,
    marketLookupTokenIdSchema,
    MarketActionStage,
    MarketActionStatus,
    MarketOfferKind,
    MarketOrderKind,
    MarketTransactionKind,
    marketPageSchema,
    orderHashSchema,
    positiveBaseUnitAmountSchema,
    prepareIdSchema,
    seaportOrderComponentsSchema,
    seaportOrderParametersSchema,
    unixSecondsSchema,
} from '../types.js';

const ADDRESS = '0x0000000000000068F116a894984e2DB1123eB395';

const HASH = `0x${'a'.repeat(64)}`;

function accepts(schema: z.ZodTypeAny, value: unknown): boolean {
    return schema.safeParse(value).success;
}

describe('address, hash and calldata schemas', () => {
    it('accepts only a 20-byte 0x-prefixed address', () => {
        expect(accepts(evmAddressSchema, ADDRESS)).toBe(true);
        expect(accepts(evmAddressSchema, ADDRESS.toLowerCase())).toBe(true);

        expect(accepts(evmAddressSchema, ADDRESS.slice(0, -1))).toBe(false);
        expect(accepts(evmAddressSchema, `${ADDRESS}0`)).toBe(false);
        expect(accepts(evmAddressSchema, ADDRESS.slice(2))).toBe(false);
        expect(accepts(evmAddressSchema, `0x${'z'.repeat(40)}`)).toBe(false);
        expect(accepts(evmAddressSchema, '')).toBe(false);
        expect(accepts(evmAddressSchema, 0)).toBe(false);
        expect(accepts(evmAddressSchema, null)).toBe(false);
    });

    it('accepts only a 32-byte 0x-prefixed value as an order hash', () => {
        expect(accepts(orderHashSchema, HASH)).toBe(true);
        expect(accepts(bytes32Schema, HASH)).toBe(true);

        expect(accepts(orderHashSchema, '0xdead')).toBe(false);
        expect(accepts(orderHashSchema, `0x${'a'.repeat(63)}`)).toBe(false);
        expect(accepts(orderHashSchema, `0x${'a'.repeat(65)}`)).toBe(false);
        expect(accepts(orderHashSchema, 'a'.repeat(64))).toBe(false);
    });

    it('accepts only whole 0x-prefixed calldata bytes', () => {
        expect(accepts(hexDataSchema, '0x')).toBe(true);
        expect(accepts(hexDataSchema, '0xdeadbeef')).toBe(true);

        expect(accepts(hexDataSchema, '0xdea')).toBe(false);
        expect(accepts(hexDataSchema, 'deadbeef')).toBe(false);
        expect(accepts(hexDataSchema, '0xzz')).toBe(false);
    });

    it('keeps a prepare id distinct from an order hash', () => {
        const prepareId = 'a'.repeat(64);

        expect(accepts(prepareIdSchema, prepareId)).toBe(true);
        expect(accepts(prepareIdSchema, HASH)).toBe(false);
        expect(accepts(prepareIdSchema, 'A'.repeat(64))).toBe(false);
        expect(accepts(prepareIdSchema, 'a'.repeat(63))).toBe(false);
        expect(accepts(orderHashSchema, prepareId)).toBe(false);
    });
});

describe('amount schemas', () => {
    it('reads returned amounts as decimal base-unit strings that may be zero', () => {
        expect(accepts(baseUnitAmountSchema, '0')).toBe(true);
        expect(accepts(baseUnitAmountSchema, '1500000000000000000')).toBe(true);

        expect(accepts(baseUnitAmountSchema, '007')).toBe(false);
        expect(accepts(baseUnitAmountSchema, '1.5')).toBe(false);
        expect(accepts(baseUnitAmountSchema, '-1')).toBe(false);
        expect(accepts(baseUnitAmountSchema, '1e18')).toBe(false);
        expect(accepts(baseUnitAmountSchema, ' 1')).toBe(false);
        expect(accepts(baseUnitAmountSchema, '')).toBe(false);
        expect(accepts(baseUnitAmountSchema, 1)).toBe(false);
        expect(accepts(baseUnitAmountSchema, 1n)).toBe(false);
    });

    it('refuses zero where the agent supplies the amount', () => {
        expect(accepts(positiveBaseUnitAmountSchema, '1')).toBe(true);
        expect(accepts(positiveBaseUnitAmountSchema, '0')).toBe(false);
        expect(accepts(positiveBaseUnitAmountSchema, '01')).toBe(false);
        expect(accepts(positiveBaseUnitAmountSchema, 1)).toBe(false);
    });

    it('keeps one identity per Cell', () => {
        expect(accepts(cellTokenIdSchema, '0')).toBe(true);
        expect(accepts(cellTokenIdSchema, '1234')).toBe(true);
        expect(accepts(cellTokenIdSchema, '2147483647')).toBe(true);
        expect(accepts(cellTokenIdSchema, '01234')).toBe(false);
        expect(accepts(cellTokenIdSchema, '2147483648')).toBe(false);
        expect(accepts(cellTokenIdSchema, 1234)).toBe(false);
    });

    it('matches the broader backend bound for a market snapshot route parameter', () => {
        expect(accepts(marketLookupTokenIdSchema, '0')).toBe(true);
        expect(accepts(marketLookupTokenIdSchema, '9223372036854775807')).toBe(true);
        expect(accepts(marketLookupTokenIdSchema, '9223372036854775808')).toBe(false);
    });
});

describe('time, chain and currency schemas', () => {
    it('accepts only non-negative whole Unix seconds', () => {
        expect(accepts(unixSecondsSchema, 0)).toBe(true);
        expect(accepts(unixSecondsSchema, 1_800_000_000)).toBe(true);
        expect(accepts(unixSecondsSchema, 253_402_300_799)).toBe(true);

        expect(accepts(unixSecondsSchema, -1)).toBe(false);
        expect(accepts(unixSecondsSchema, 1.5)).toBe(false);
        expect(accepts(unixSecondsSchema, '1800000000')).toBe(false);
        expect(accepts(unixSecondsSchema, Number.NaN)).toBe(false);
        expect(accepts(unixSecondsSchema, 253_402_300_800)).toBe(false);
    });

    it('accepts only a positive whole chain id', () => {
        expect(accepts(chainIdSchema, 42161)).toBe(true);

        expect(accepts(chainIdSchema, 0)).toBe(false);
        expect(accepts(chainIdSchema, -1)).toBe(false);
        expect(accepts(chainIdSchema, 1.5)).toBe(false);
        expect(accepts(chainIdSchema, '42161')).toBe(false);
    });

    it('requires the address, symbol and decimals needed to read a price', () => {
        const currency = { address: ADDRESS, symbol: 'WETH', decimals: 18 };

        expect(accepts(marketCurrencySchema, currency)).toBe(true);

        expect(accepts(marketCurrencySchema, { ...currency, address: '0xdead' })).toBe(false);
        expect(accepts(marketCurrencySchema, { ...currency, symbol: '' })).toBe(false);
        expect(accepts(marketCurrencySchema, { ...currency, decimals: -1 })).toBe(false);
        expect(accepts(marketCurrencySchema, { ...currency, decimals: 18.5 })).toBe(false);
        expect(accepts(marketCurrencySchema, { ...currency, decimals: 37 })).toBe(false);
        expect(accepts(marketCurrencySchema, { ...currency, decimals: '18' })).toBe(false);
        expect(accepts(marketCurrencySchema, { address: ADDRESS, symbol: 'WETH' })).toBe(false);
        expect(accepts(marketCurrencySchema, {})).toBe(false);
    });
});

describe('paging schema', () => {
    it('spells the end of a page as an explicit null cursor, never as a missing field', () => {
        const page = marketPageSchema(cellTokenIdSchema);

        expect(accepts(page, { items: ['1', '2'], nextCursor: 'abc' })).toBe(true);
        expect(accepts(page, { items: [], nextCursor: null })).toBe(true);

        expect(accepts(page, { items: [] })).toBe(false);
        expect(accepts(page, { items: [], nextCursor: '' })).toBe(false);
        expect(accepts(page, { nextCursor: null })).toBe(false);
        expect(accepts(cursorSchema, '')).toBe(false);
    });
});

describe('Seaport order shapes', () => {
    const offerItem = {
        itemType: 2,
        token: ADDRESS,
        identifierOrCriteria: '1234',
        startAmount: '1',
        endAmount: '1',
    };

    const considerationItem = {
        itemType: 0,
        token: `0x${'0'.repeat(40)}`,
        identifierOrCriteria: '0',
        startAmount: '1500000000000000000',
        endAmount: '1500000000000000000',
        recipient: ADDRESS,
    };

    const components = {
        offerer: ADDRESS,
        zone: `0x${'0'.repeat(40)}`,
        offer: [offerItem],
        consideration: [considerationItem],
        orderType: 0,
        startTime: '1800000000',
        endTime: '1800086400',
        zoneHash: `0x${'0'.repeat(64)}`,
        salt: '12345678901234567890',
        conduitKey: `0x${'0'.repeat(64)}`,
        counter: '0',
    };

    const parameters = { ...components, totalOriginalConsiderationItems: 1 };

    it('turns the transport order parameters into exactly the signable components', () => {
        const parsed = seaportOrderComponentsSchema.parse(parameters);

        expect(parsed).toEqual(components);
        expect(Object.keys(parsed)).not.toContain('totalOriginalConsiderationItems');
        expect(Object.keys(parsed).sort()).toEqual(Object.keys(components).sort());
    });

    it('keeps the counter inside the signable components', () => {
        expect(accepts(seaportOrderComponentsSchema, { ...components, counter: undefined })).toBe(false);
        expect(seaportOrderComponentsSchema.parse(parameters).counter).toBe('0');
    });

    it('keeps the consideration count on the parameters and only there', () => {
        expect(accepts(seaportOrderParametersSchema, parameters)).toBe(true);
        expect(accepts(seaportOrderParametersSchema, components)).toBe(false);
        expect(seaportOrderParametersSchema.parse(parameters).totalOriginalConsiderationItems).toBe(1);
    });

    it('requires a recipient on consideration items and refuses one on offer items', () => {
        const withoutRecipient = { ...components, consideration: [{ ...considerationItem, recipient: undefined }] };

        expect(accepts(seaportOrderComponentsSchema, withoutRecipient)).toBe(false);
        expect(Object.keys(seaportOrderComponentsSchema.parse(components).offer[0] ?? {})).toEqual([
            'itemType',
            'token',
            'identifierOrCriteria',
            'startAmount',
            'endAmount',
        ]);
    });

    it('keeps every Seaport numeric field a base-unit string, never a JavaScript number', () => {
        expect(accepts(seaportOrderComponentsSchema, { ...components, salt: 12345 })).toBe(false);
        expect(accepts(seaportOrderComponentsSchema, { ...components, startTime: 1_800_000_000 })).toBe(false);
        expect(accepts(seaportOrderComponentsSchema, { ...components, counter: 0 })).toBe(false);
        expect(accepts(seaportOrderComponentsSchema, { ...components, salt: `0x${'f'.repeat(8)}` })).toBe(false);
    });
});

describe('market enums', () => {
    it('pins the wire spelling of every named domain value', () => {
        expect(Object.values(MarketOfferKind)).toEqual(['item', 'trait', 'collection']);
        expect(Object.values(MarketOrderKind)).toEqual(['listing', 'offer']);
        expect(Object.values(MarketTransactionKind)).toEqual([
            'collectionApproval',
            'currencyApproval',
            'fulfillment',
            'cancellation',
        ]);
        expect(Object.values(MarketActionStatus)).toEqual(['completed', 'already_completed']);
        expect(Object.values(MarketActionStage)).toEqual([
            'read',
            'reconcile',
            'prepare',
            'approve',
            'sign',
            'submit',
            'fulfil',
            'cancel',
            'verify',
        ]);
    });
});
