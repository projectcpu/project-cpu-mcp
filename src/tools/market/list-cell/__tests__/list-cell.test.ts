import { decodeFunctionData } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    approvalData,
    approvalWire,
    BARE_APPROVAL_SELECTOR,
    COLLECTION,
    CONDUIT,
    CONDUIT_KEY,
    CREATOR_FEE,
    EXPIRES_AT,
    FakeAppConfig,
    FakeSellerWallet,
    FEE_RECIPIENT,
    INTENT_DEADLINE,
    listCellArgs,
    listCellHarness,
    listingsPageWire,
    MarketRoute,
    NATIVE_ADDRESS,
    NATIVE_CURRENCY,
    NOW_SECONDS,
    ORDER_HASH,
    PLATFORM_FEE,
    PREPARE_ID,
    PRICE,
    priceWire,
    privateSaleMarkerWire,
    preparedWire,
    PROCEEDS,
    publishedListingWire,
    parsed,
    reply,
    RESERVED_BUYER,
    reservedPreparedWire,
    RoutedMarketTransport,
    seaportOrderWire,
    SELLER,
    settle,
    submittedWire,
    TOKEN_ID,
} from './fixtures.js';
import { ERC721_OPERATOR_ABI } from '../../../../contracts/erc721.abi.js';
import { SEAPORT_ADDRESS } from '../../../../contracts/seaport.constants.js';
import { errorWire } from '../../../../services/market/__tests__/fixtures.js';
import { MarketActionTool } from '../../../../services/market/action.types.js';
import { MarketError } from '../../../../services/market/error.js';
import {
    MARKET_PROFILE_CACHE_MS,
    MARKET_RECONCILE_MAX_PAGES,
    MARKET_UNRESOLVED_ACTION_LIMIT,
} from '../../../../services/market/recovery.constants.js';
import { MarketRecoveryStore } from '../../../../services/market/recovery.store.js';
import { MarketActionStage, MarketActionStatus, MarketErrorCode } from '../../../../services/market/types.js';
import { TxStatus } from '../../../../wallet/types.js';

const EMPTY_PAGE = reply(200, listingsPageWire([], null));

function routes(over: Partial<Record<MarketRoute, Array<unknown>>> = {}): RoutedMarketTransport {
    return new RoutedMarketTransport({
        [MarketRoute.MyListings]: [EMPTY_PAGE],
        [MarketRoute.Prepare]: [reply(200, preparedWire())],
        [MarketRoute.Submit]: [reply(200, submittedWire())],
        ...over,
    } as ConstructorParameters<typeof RoutedMarketTransport>[0]);
}

async function failure(promise: Promise<unknown>): Promise<MarketError> {
    return (await settle(promise)) as MarketError;
}

describe('publishing a Cell listing', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('prepares, signs and publishes a public listing in one call', async () => {
        const harness = listCellHarness(routes());

        const result = parsed(await harness.handler(listCellArgs()));

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(result.tokenId).toBe(TOKEN_ID);
        expect(result.grossPrice).toBe(PRICE);
        expect(result.platformFee).toBe(PLATFORM_FEE);
        expect(result.creatorFee).toBe(CREATOR_FEE);
        expect(result.estimatedProceeds).toBe(PROCEEDS);
        expect(result.approvalTxHashes).toEqual([]);
        expect((result.listing as { orderHash: string }).orderHash).toBe(ORDER_HASH);
    });

    it('leaves a null reserved buyer out of the prepare request rather than sending JSON null', async () => {
        const harness = listCellHarness(routes());

        await harness.handler(listCellArgs());

        const body = harness.transport.callsOn(MarketRoute.Prepare)[0]?.body as Record<string, unknown>;
        expect(body).toEqual({ tokenId: TOKEN_ID, price: PRICE, expirationTime: EXPIRES_AT });
        expect('buyerAddress' in body).toBe(false);
    });

    it('reserves the listing for one buyer when an address is supplied', async () => {
        const harness = listCellHarness(routes({ [MarketRoute.Prepare]: [reply(200, reservedPreparedWire())] }));

        const result = parsed(await harness.handler(listCellArgs({ buyerAddress: RESERVED_BUYER })));

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect((harness.transport.callsOn(MarketRoute.Prepare)[0]?.body as Record<string, unknown>).buyerAddress).toBe(
            RESERVED_BUYER,
        );
    });

    it('submits the returned prepare id with the locally produced signature', async () => {
        const harness = listCellHarness(routes());

        await harness.handler(listCellArgs());

        expect(harness.transport.callsOn(MarketRoute.Submit)[0]?.body).toEqual({
            prepareId: PREPARE_ID,
            signature: `0x${'ab'.repeat(65)}`,
        });
    });

    it('treats the successful submit as authoritative and does not re-read the marketplace afterwards', async () => {
        const harness = listCellHarness(routes());

        await harness.handler(listCellArgs());

        expect(harness.transport.callsOn(MarketRoute.MyListings)).toHaveLength(1);
        expect(harness.transport.calls.map((call) => call.path).at(-1)).toContain('/listings/submit');
    });

    it('signs the order the protocol verifies, without the transport-only consideration count', async () => {
        const harness = listCellHarness(routes());

        await harness.handler(listCellArgs());

        const signed = harness.wallet.signed[0];
        expect(signed?.primaryType).toBe('OrderComponents');
        expect(signed?.domain.verifyingContract).toBe('0x0000000000000068F116a894984e2DB1123eB395');
        expect(signed?.domain.chainId).toBe(42161);
        expect(signed?.message).not.toHaveProperty('totalOriginalConsiderationItems');
        expect(signed?.message.salt).toBe('987654321');
    });
});

describe('the approvals a listing still owes', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('broadcasts them in the returned order and observes each receipt before signing', async () => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.Prepare]: [
                    reply(200, preparedWire({ approvals: [approvalWire(COLLECTION), approvalWire(COLLECTION)] })),
                ],
            }),
        );

        const result = parsed(await harness.handler(listCellArgs()));

        expect(harness.wallet.log).toEqual([
            `send:${COLLECTION}`,
            `receipt:0x${'1'.repeat(64)}`,
            `send:${COLLECTION}`,
            `receipt:0x${'2'.repeat(64)}`,
            'sign',
        ]);
        expect(result.approvalTxHashes).toEqual([`0x${'1'.repeat(64)}`, `0x${'2'.repeat(64)}`]);
    });

    it.each([
        ['is pointed at anything but the Cell collection', `0x${'9'.repeat(40)}`, {}],
        ['carries an approval selector with no arguments behind it', COLLECTION, { data: BARE_APPROVAL_SELECTOR }],
        ['is not an approval at all', COLLECTION, { data: '0xdeadbeef' }],
        [
            'hands every Cell to an operator the signed order is not settled by',
            COLLECTION,
            { data: approvalData(RESERVED_BUYER) },
        ],
        ['withdraws an approval rather than granting one', COLLECTION, { data: approvalData(SEAPORT_ADDRESS, false) }],
    ])('refuses a prepared collection approval that %s', async (_label, to, over) => {
        const harness = listCellHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire({ approvals: [approvalWire(to, over)] }))] }),
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.broadcast).toHaveLength(0);
        expect(harness.wallet.signed).toHaveLength(0);
    });

    it('approves the conduit the signed order names when it settles through one', async () => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.Prepare]: [
                    reply(
                        200,
                        preparedWire({
                            approvals: [approvalWire(COLLECTION, { data: approvalData(CONDUIT) })],
                            order: seaportOrderWire({ conduitKey: CONDUIT_KEY }),
                        }),
                    ),
                ],
            }),
        );

        await harness.handler(listCellArgs());

        expect(
            decodeFunctionData({ abi: ERC721_OPERATOR_ABI, data: harness.wallet.broadcast[0]?.data ?? '0x' }),
        ).toEqual({ functionName: 'setApprovalForAll', args: [CONDUIT, true] });
    });

    it('refuses an operator the protocol registry disowns for the order it would sign', async () => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.Prepare]: [
                    reply(
                        200,
                        preparedWire({
                            approvals: [approvalWire(COLLECTION, { data: approvalData(CONDUIT) })],
                            order: seaportOrderWire({ conduitKey: CONDUIT_KEY }),
                        }),
                    ),
                ],
            }),
            new FakeSellerWallet({ conduit: null }),
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.broadcast).toHaveLength(0);
        expect(harness.wallet.signed).toHaveLength(0);
    });

    it('stops at a reverted approval and never signs or publishes the order', async () => {
        const harness = listCellHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire({ approvals: [approvalWire(COLLECTION)] }))] }),
            new FakeSellerWallet({ receiptStatus: TxStatus.Reverted }),
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.TransactionReverted);
        expect(error.stage).toBe(MarketActionStage.Approve);
        expect(error.txHash).toBe(`0x${'1'.repeat(64)}`);
        expect(harness.wallet.log).not.toContain('sign');
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });
});

describe('the fee split a listing discloses', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('accepts a collection whose platform and creator fees are both zero', async () => {
        const prepared = preparedWire({
            fees: {
                grossPrice: priceWire(PRICE),
                platformFee: priceWire('0'),
                creatorFee: priceWire('0'),
                estimatedProceeds: priceWire(PRICE),
            },
            order: seaportOrderWire({
                consideration: [
                    {
                        itemType: 1,
                        token: `0x${'3'.repeat(40)}`,
                        identifierOrCriteria: '0',
                        startAmount: PRICE,
                        endAmount: PRICE,
                        recipient: `0x${'1'.repeat(40)}`,
                    },
                ],
                totalOriginalConsiderationItems: 1,
            }),
        });
        const harness = listCellHarness(routes({ [MarketRoute.Prepare]: [reply(200, prepared)] }));

        const result = parsed(await harness.handler(listCellArgs()));

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(result.platformFee).toBe('0');
        expect(result.creatorFee).toBe('0');
        expect(result.estimatedProceeds).toBe(PRICE);
    });

    it('refuses to sign when the fees and proceeds do not add up to the gross price', async () => {
        const prepared = preparedWire({
            fees: {
                grossPrice: priceWire(PRICE),
                platformFee: priceWire(PLATFORM_FEE),
                creatorFee: priceWire(CREATOR_FEE),
                estimatedProceeds: priceWire(PRICE),
            },
        });
        const harness = listCellHarness(routes({ [MarketRoute.Prepare]: [reply(200, prepared)] }));

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });

    it('refuses to sign a fee split that does not add up, even when the order collects the right total', async () => {
        const prepared = preparedWire({
            fees: {
                grossPrice: priceWire(PRICE),
                platformFee: priceWire(PLATFORM_FEE),
                creatorFee: priceWire('0'),
                estimatedProceeds: priceWire(PROCEEDS),
            },
        });
        const harness = listCellHarness(routes({ [MarketRoute.Prepare]: [reply(200, prepared)] }));

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });

    it('refuses to sign an order that pays the seller side something other than the gross price', async () => {
        const prepared = preparedWire({
            order: seaportOrderWire({
                consideration: [
                    {
                        itemType: 1,
                        token: `0x${'3'.repeat(40)}`,
                        identifierOrCriteria: '0',
                        startAmount: '1',
                        endAmount: '1',
                        recipient: `0x${'1'.repeat(40)}`,
                    },
                ],
                totalOriginalConsiderationItems: 1,
            }),
        });
        const harness = listCellHarness(routes({ [MarketRoute.Prepare]: [reply(200, prepared)] }));

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.signed).toHaveLength(0);
    });
});

describe('the local checks a prepared listing must pass', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        ['another chain', { chainId: 1 }, MarketErrorCode.ChainMismatch],
        [
            'another protocol contract',
            { protocolAddress: `0x${'7'.repeat(40)}` },
            MarketErrorCode.ProtocolAddressMismatch,
        ],
        ['another seller', { order: seaportOrderWire({ offerer: `0x${'8'.repeat(40)}` }) }, MarketErrorCode.WrongOwner],
        [
            'another Cell',
            {
                order: seaportOrderWire({
                    offer: [{ ...(seaportOrderWire().offer as Array<object>)[0], identifierOrCriteria: '999' }],
                }),
            },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'another price',
            {
                fees: {
                    ...(preparedWire().fees as object),
                    grossPrice: priceWire('5'),
                },
            },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'another expiry',
            { order: seaportOrderWire({ endTime: (EXPIRES_AT + 60).toString() }) },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'a reserved buyer nobody asked for',
            {
                order: seaportOrderWire({
                    orderType: 2,
                    zone: `0x${'6'.repeat(40)}`,
                    consideration: [...(seaportOrderWire().consideration as Array<object>), privateSaleMarkerWire()],
                    totalOriginalConsiderationItems: (seaportOrderWire().consideration as Array<object>).length + 1,
                }),
            },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'a currency approval a listing never needs',
            { approvals: [{ ...approvalWire(COLLECTION), kind: 'currencyApproval' }] },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'an order offering a different Cell',
            {
                order: seaportOrderWire({
                    offer: [{ ...(seaportOrderWire().offer as Array<object>)[0], identifierOrCriteria: '999' }],
                }),
            },
            MarketErrorCode.InvalidMarketResponse,
        ],
    ])('refuses a prepared listing that names %s', async (_label, over, code) => {
        const harness = listCellHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire(over as Record<string, unknown>))] }),
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(code);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });
});

function offerWire(over: Record<string, unknown>): Array<Record<string, unknown>> {
    const offer = seaportOrderWire().offer as Array<Record<string, unknown>>;
    return [{ ...offer[0], ...over }];
}

function considerationWire(over: Record<string, unknown> = {}): Array<Record<string, unknown>> {
    const consideration = seaportOrderWire().consideration as Array<Record<string, unknown>>;
    return consideration.map((item) => ({ ...item, ...over }));
}

function firstConsiderationWire(over: Record<string, unknown>): Array<Record<string, unknown>> {
    const consideration = considerationWire();
    return consideration.map((item, index) => (index === 0 ? { ...item, ...over } : item));
}

function lastConsiderationWire(over: Record<string, unknown>): Array<Record<string, unknown>> {
    const consideration = considerationWire();
    return consideration.map((item, index) => (index === consideration.length - 1 ? { ...item, ...over } : item));
}

describe('the complete order a listing asks the wallet to sign', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        [
            'a price that ends lower than it starts',
            { order: seaportOrderWire({ consideration: considerationWire({ endAmount: '1' }) }) },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'part of the price paid in another currency',
            { order: seaportOrderWire({ consideration: firstConsiderationWire({ token: `0x${'d'.repeat(40)}` }) }) },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'part of the price paid as a token rather than an amount',
            { order: seaportOrderWire({ consideration: firstConsiderationWire({ identifierOrCriteria: '9' }) }) },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'part of the price paid in a kind of item the currency is not',
            { order: seaportOrderWire({ consideration: firstConsiderationWire({ itemType: 2 }) }) },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'a seller share smaller than the proceeds it discloses',
            { order: seaportOrderWire({ consideration: firstConsiderationWire({ recipient: FEE_RECIPIENT }) }) },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'more consideration items than it declares',
            { order: seaportOrderWire({ totalOriginalConsiderationItems: 2 }) },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'a Cell from another collection',
            { order: seaportOrderWire({ offer: offerWire({ token: `0x${'d'.repeat(40)}` }) }) },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'an offered item that is not an ERC-721',
            { order: seaportOrderWire({ offer: offerWire({ itemType: 1 }) }) },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'more than one unit of the Cell',
            { order: seaportOrderWire({ offer: offerWire({ startAmount: '2', endAmount: '2' }) }) },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'an order type a wallet-signed listing never uses',
            { order: seaportOrderWire({ orderType: 4 }) },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'a zone on an order nothing restricts',
            { order: seaportOrderWire({ zone: `0x${'a'.repeat(40)}` }) },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'a start time the prepared listing does not carry',
            { order: seaportOrderWire({ startTime: '9999999999' }) },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'an end time later than the requested expiry',
            { order: seaportOrderWire({ endTime: (EXPIRES_AT + 60).toString() }) },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'a Cell that is not fillable for another hour',
            {
                order: seaportOrderWire({ startTime: (NOW_SECONDS + 3_600).toString() }),
            },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'an offerer that is not this wallet',
            { order: seaportOrderWire({ offerer: `0x${'8'.repeat(40)}` }) },
            MarketErrorCode.WrongOwner,
        ],
        [
            'a collection approval on another chain',
            { approvals: [{ ...approvalWire(COLLECTION), chainId: 1 }] },
            MarketErrorCode.InvalidMarketResponse,
        ],
    ])('refuses to sign an order carrying %s', async (_label, over, code) => {
        const harness = listCellHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire(over as Record<string, unknown>))] }),
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(code);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });

    it('signs the prepared order itself, changing nothing but the transport-only count', async () => {
        const harness = listCellHarness(routes());

        await harness.handler(listCellArgs());

        const { totalOriginalConsiderationItems: _count, ...expected } = seaportOrderWire();
        expect(harness.wallet.signed[0]?.message).toEqual(expected);
    });

    it.each([
        ['another recipient', { recipient: FEE_RECIPIENT }],
        ['another collection', { token: FEE_RECIPIENT }],
        ['another Cell', { identifierOrCriteria: '999' }],
        ['more than one Cell', { startAmount: '2', endAmount: '2' }],
        ['another item type', { itemType: 3 }],
    ])('refuses a reserved listing whose private-sale marker names %s', async (_label, markerOver) => {
        const order = seaportOrderWire();
        const consideration = [
            ...(order.consideration as Array<Record<string, unknown>>),
            privateSaleMarkerWire(markerOver),
        ];
        const harness = listCellHarness(
            routes({
                [MarketRoute.Prepare]: [
                    reply(
                        200,
                        reservedPreparedWire({ consideration, totalOriginalConsiderationItems: consideration.length }),
                    ),
                ],
            }),
        );

        const error = await failure(harness.handler(listCellArgs({ buyerAddress: RESERVED_BUYER })));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });

    it('refuses a private-sale marker that is not the final consideration item', async () => {
        const order = seaportOrderWire();
        const consideration = [privateSaleMarkerWire(), ...(order.consideration as Array<Record<string, unknown>>)];
        const harness = listCellHarness(
            routes({
                [MarketRoute.Prepare]: [
                    reply(
                        200,
                        reservedPreparedWire({ consideration, totalOriginalConsiderationItems: consideration.length }),
                    ),
                ],
            }),
        );

        const error = await failure(harness.handler(listCellArgs({ buyerAddress: RESERVED_BUYER })));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });

    it('refuses to sign an order whose payments overshoot the gross price the seller set', async () => {
        const prepared = preparedWire({
            order: seaportOrderWire({
                consideration: lastConsiderationWire({
                    startAmount: '50000000000000001',
                    endAmount: '50000000000000001',
                }),
            }),
        });
        const harness = listCellHarness(routes({ [MarketRoute.Prepare]: [reply(200, prepared)] }));

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });

    it('names an order that pays the seller side nothing at all for what it is', async () => {
        const prepared = preparedWire({
            order: seaportOrderWire({ consideration: [], totalOriginalConsiderationItems: 0 }),
        });
        const harness = listCellHarness(routes({ [MarketRoute.Prepare]: [reply(200, prepared)] }));

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(error.message).toContain('pays the seller side nothing at all');
        expect(harness.wallet.signed).toHaveLength(0);
    });

    it('publishes a listing priced in the chain currency, whose payments are native amounts', async () => {
        const prepared = preparedWire({
            fees: {
                ...(preparedWire().fees as object),
                grossPrice: priceWire(PRICE, NATIVE_CURRENCY),
            },
            order: seaportOrderWire({ consideration: considerationWire({ itemType: 0, token: NATIVE_ADDRESS }) }),
        });
        const harness = listCellHarness(routes({ [MarketRoute.Prepare]: [reply(200, prepared)] }));

        const result = parsed(await harness.handler(listCellArgs()));

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect((result.currency as { symbol: string }).symbol).toBe('ETH');
        expect(harness.wallet.signed).toHaveLength(1);
    });

    it('refuses to sign a chain-currency price paid as a token amount', async () => {
        const prepared = preparedWire({
            fees: {
                ...(preparedWire().fees as object),
                grossPrice: priceWire(PRICE, NATIVE_CURRENCY),
            },
            order: seaportOrderWire({ consideration: considerationWire({ token: NATIVE_ADDRESS }) }),
        });
        const harness = listCellHarness(routes({ [MarketRoute.Prepare]: [reply(200, prepared)] }));

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.signed).toHaveLength(0);
    });

    it('refuses to prepare at all when the Cell collection is not configured for this network', async () => {
        const recovery = new MarketRecoveryStore();
        const harness = listCellHarness(
            routes(),
            new FakeSellerWallet(),
            recovery,
            new FakeAppConfig('the-cell-collection-is-missing'),
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(recovery.size()).toBe(0);
    });

    it('refuses a USDG listing price finer than one cent before it signs or submits', async () => {
        const harness = listCellHarness(routes());

        const error = await failure(harness.handler(listCellArgs({ price: '9000' })));

        expect(error.code).toBe(MarketErrorCode.InvalidInput);
        expect(error.message).toContain('whole cent increments');
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(1);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });

    it('accepts an order whose whole price reaches a seller who is also the fee recipient', async () => {
        const prepared = preparedWire({
            order: seaportOrderWire({ consideration: considerationWire({ recipient: SELLER }) }),
        });
        const harness = listCellHarness(routes({ [MarketRoute.Prepare]: [reply(200, prepared)] }));

        const result = parsed(await harness.handler(listCellArgs()));

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(result.estimatedProceeds).toBe(PROCEEDS);
    });
});

describe('the deadline a prepared listing stops at', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('refuses to sign a prepared intent that is already past its own deadline', async () => {
        const harness = listCellHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire({ expiresAt: NOW_SECONDS - 1 }))] }),
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.PreparedIntentExpired);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });

    it('stops at the order expiry when it falls before the prepared-intent deadline', async () => {
        const shortExpiry = NOW_SECONDS + 60;
        const prepared = preparedWire({
            expiresAt: INTENT_DEADLINE,
            order: seaportOrderWire({ endTime: shortExpiry.toString() }),
            approvals: [approvalWire(COLLECTION)],
        });
        const harness = listCellHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, prepared)] }),
            new FakeSellerWallet({ clockJumpMs: 120_000 }),
        );

        const error = await failure(harness.handler(listCellArgs({ expirationTime: shortExpiry })));

        expect(error.code).toBe(MarketErrorCode.PreparedIntentExpired);
        expect(error.stage).toBe(MarketActionStage.Sign);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });
});

describe('two callers asking for the same listing at once', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('share one operation instead of publishing two orders', async () => {
        const harness = listCellHarness(routes());

        const [left, right] = await Promise.all([harness.handler(listCellArgs()), harness.handler(listCellArgs())]);

        expect(parsed(left).status).toBe(MarketActionStatus.Completed);
        expect(parsed(right)).toEqual(parsed(left));
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(1);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
    });
});

describe('an equivalent listing that is already active', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('blocks a new prepare, because a reserved buyer cannot be proven from outside', async () => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [reply(200, listingsPageWire([publishedListingWire()], null))],
            }),
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.ActiveOrderExists);
        expect(error.retryable).toBe(false);
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
    });

    it('pages on until it can rule the conflict out', async () => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [
                    reply(200, listingsPageWire([publishedListingWire({ tokenId: '77' })], 'page-2')),
                    reply(200, listingsPageWire([publishedListingWire()], null)),
                ],
            }),
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.ActiveOrderExists);
        expect(harness.transport.callsOn(MarketRoute.MyListings)).toHaveLength(2);
    });

    it.each([
        ['another price', { price: '7' }],
        ['another expiry', { expirationTime: EXPIRES_AT + 60 }],
        ['another maker', { maker: `0x${'8'.repeat(40)}` }],
    ])('does not mistake a listing of the same Cell at %s for this intent', async (_label, over) => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [reply(200, listingsPageWire([publishedListingWire(over)], null))],
            }),
        );

        const result = parsed(await harness.handler(listCellArgs()));

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(1);
    });

    it('refuses a fresh prepare when the active listings do not fit in the pages it may read', async () => {
        const harness = listCellHarness(
            routes({ [MarketRoute.MyListings]: [reply(200, listingsPageWire([], 'another-page'))] }),
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(error.retryable).toBe(true);
        expect(harness.transport.callsOn(MarketRoute.MyListings)).toHaveLength(MARKET_RECONCILE_MAX_PAGES);
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
    });
});

describe('a submit whose outcome is uncertain', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('reconciles the marketplace and reports the order it finds as already completed', async () => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [EMPTY_PAGE, reply(200, listingsPageWire([publishedListingWire()], null))],
                [MarketRoute.Submit]: [new Error('socket hang up')],
            }),
        );

        const result = parsed((await settle(harness.handler(listCellArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.AlreadyCompleted);
        expect((result.listing as { orderHash: string }).orderHash).toBe(ORDER_HASH);
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(1);
        expect(harness.recovery.size()).toBe(0);
    });

    it('waits for the read snapshot to advance before it calls the order absent, then resubmits the same intent', async () => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [EMPTY_PAGE, EMPTY_PAGE],
                [MarketRoute.Submit]: [
                    reply(429, errorWire('upstreamRateLimited', 'slow down'), { 'retry-after': '600' }),
                    reply(200, submittedWire()),
                ],
            }),
        );
        const startedAt = Date.now();

        const result = parsed((await settle(harness.handler(listCellArgs()))) as never);
        const submits = harness.transport.callsOn(MarketRoute.Submit);

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(submits).toHaveLength(2);
        expect(submits[1]?.body).toEqual(submits[0]?.body);
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(1);
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(MARKET_PROFILE_CACHE_MS);
    });

    it('reports an unknown outcome and keeps the intent when the marketplace cannot be read', async () => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [EMPTY_PAGE, reply(503, errorWire('x', 'down'))],
                [MarketRoute.Submit]: [
                    reply(429, errorWire('upstreamRateLimited', 'slow down'), { 'retry-after': '600' }),
                ],
            }),
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(error.retryable).toBe(true);
        expect(harness.recovery.size()).toBe(1);
    });

    it('resumes the retained intent on the next call rather than preparing a second order', async () => {
        const transport = routes({
            [MarketRoute.MyListings]: [EMPTY_PAGE, reply(503, errorWire('x', 'down'))],
            [MarketRoute.Submit]: [reply(429, errorWire('upstreamRateLimited', 'slow down'), { 'retry-after': '600' })],
        });
        const recovery = new MarketRecoveryStore();
        const first = listCellHarness(transport, new FakeSellerWallet(), recovery);
        await settle(first.handler(listCellArgs()));

        const resumed = listCellHarness(
            routes({ [MarketRoute.Submit]: [reply(200, submittedWire())] }),
            new FakeSellerWallet(),
            recovery,
        );
        const result = parsed((await settle(resumed.handler(listCellArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(resumed.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
        expect(resumed.transport.callsOn(MarketRoute.Submit)[0]?.body).toEqual({
            prepareId: PREPARE_ID,
            signature: `0x${'ab'.repeat(65)}`,
        });
        expect(recovery.size()).toBe(0);
    });

    it('reconciles an expired prepared intent before it will let a fresh order be prepared', async () => {
        const transport = routes({
            [MarketRoute.MyListings]: [EMPTY_PAGE, reply(503, errorWire('x', 'down'))],
            [MarketRoute.Submit]: [reply(429, errorWire('upstreamRateLimited', 'slow down'), { 'retry-after': '600' })],
        });
        const recovery = new MarketRecoveryStore();
        await settle(listCellHarness(transport, new FakeSellerWallet(), recovery).handler(listCellArgs()));
        vi.setSystemTime((INTENT_DEADLINE + 1) * 1_000);

        const later = listCellHarness(
            routes({ [MarketRoute.MyListings]: [reply(200, listingsPageWire([publishedListingWire()], null))] }),
            new FakeSellerWallet(),
            recovery,
        );
        const result = parsed((await settle(later.handler(listCellArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.AlreadyCompleted);
        expect(later.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
        expect(recovery.size()).toBe(0);
    });

    it('keeps an expired prepared intent when the marketplace is unavailable, rather than recreating it', async () => {
        const transport = routes({
            [MarketRoute.MyListings]: [EMPTY_PAGE, reply(503, errorWire('x', 'down'))],
            [MarketRoute.Submit]: [reply(429, errorWire('upstreamRateLimited', 'slow down'), { 'retry-after': '600' })],
        });
        const recovery = new MarketRecoveryStore();
        await settle(listCellHarness(transport, new FakeSellerWallet(), recovery).handler(listCellArgs()));
        vi.setSystemTime((INTENT_DEADLINE + 1) * 1_000);

        const later = listCellHarness(
            routes({ [MarketRoute.MyListings]: [reply(503, errorWire('x', 'down'))] }),
            new FakeSellerWallet(),
            recovery,
        );
        const error = await failure(later.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(later.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
        expect(recovery.size()).toBe(1);
    });

    it('drops the intent when the server refused the submission before it could publish anything', async () => {
        const recovery = new MarketRecoveryStore();
        const first = listCellHarness(
            routes({
                [MarketRoute.Submit]: [reply(400, errorWire('preparedIntentFlowMismatch', 'wrong flow'))],
            }),
            new FakeSellerWallet(),
            recovery,
        );

        const error = await failure(first.handler(listCellArgs()));
        expect(error.code).toBe(MarketErrorCode.PreparedIntentFlowMismatch);
        expect(first.transport.callsOn(MarketRoute.MyListings)).toHaveLength(1);
        expect(recovery.size()).toBe(0);

        const second = listCellHarness(routes(), new FakeSellerWallet(), recovery);
        const result = parsed((await settle(second.handler(listCellArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(second.transport.callsOn(MarketRoute.Prepare)).toHaveLength(1);
    });

    it('keeps the intent when a terminal code answers a resubmission the server may have published', async () => {
        const recovery = new MarketRecoveryStore();
        const first = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [EMPTY_PAGE],
                [MarketRoute.Submit]: [
                    reply(429, errorWire('upstreamRateLimited', 'slow down'), { 'retry-after': '600' }),
                    reply(400, errorWire('preparedIntentNotFound', 'that prepare is gone')),
                ],
            }),
            new FakeSellerWallet(),
            recovery,
        );

        const error = await failure(first.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(error.retryable).toBe(true);
        expect(first.transport.callsOn(MarketRoute.Submit)).toHaveLength(2);
        expect(recovery.size()).toBe(1);

        const second = listCellHarness(
            routes({ [MarketRoute.Submit]: [reply(200, submittedWire())] }),
            new FakeSellerWallet(),
            recovery,
        );
        const result = parsed((await settle(second.handler(listCellArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(second.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
        expect(second.transport.callsOn(MarketRoute.Submit)[0]?.body).toEqual({
            prepareId: PREPARE_ID,
            signature: `0x${'ab'.repeat(65)}`,
        });
    });

    it('reports the order a terminal resubmission left behind as already completed', async () => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [
                    EMPTY_PAGE,
                    EMPTY_PAGE,
                    reply(200, listingsPageWire([publishedListingWire()], null)),
                ],
                [MarketRoute.Submit]: [
                    reply(429, errorWire('upstreamRateLimited', 'slow down'), { 'retry-after': '600' }),
                    reply(400, errorWire('preparedIntentNotFound', 'that prepare is gone')),
                ],
            }),
        );

        const result = parsed((await settle(harness.handler(listCellArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.AlreadyCompleted);
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(1);
        expect(harness.recovery.size()).toBe(0);
    });

    it('reconciles a success it cannot read rather than dropping an order that may be live', async () => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [EMPTY_PAGE, reply(200, listingsPageWire([publishedListingWire()], null))],
                [MarketRoute.Submit]: [reply(200, { listing: { orderHash: 'not-a-hash' } })],
            }),
        );
        const startedAt = Date.now();

        const result = parsed((await settle(harness.handler(listCellArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.AlreadyCompleted);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
        expect(harness.recovery.size()).toBe(0);
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(MARKET_PROFILE_CACHE_MS);
    });

    it('keeps the intent when a success it cannot read is followed by a marketplace that shows nothing', async () => {
        const recovery = new MarketRecoveryStore();
        const first = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [EMPTY_PAGE],
                [MarketRoute.Submit]: [reply(200, { listing: { orderHash: 'not-a-hash' } })],
            }),
            new FakeSellerWallet(),
            recovery,
        );

        const error = await failure(first.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(recovery.size()).toBe(1);

        const second = listCellHarness(
            routes({ [MarketRoute.Submit]: [reply(200, submittedWire())] }),
            new FakeSellerWallet(),
            recovery,
        );
        parsed((await settle(second.handler(listCellArgs()))) as never);

        expect(second.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
    });

    it('calls the outcome unknown when the reconcile scan cannot reach the end of the listings', async () => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [EMPTY_PAGE, reply(200, listingsPageWire([], 'another-page'))],
                [MarketRoute.Submit]: [
                    reply(429, errorWire('upstreamRateLimited', 'slow down'), { 'retry-after': '600' }),
                ],
            }),
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
        expect(harness.recovery.size()).toBe(1);
    });

    it('checks the deadline again before every submit attempt', async () => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [EMPTY_PAGE],
                [MarketRoute.Prepare]: [reply(200, preparedWire({ expiresAt: NOW_SECONDS + 5 }))],
                [MarketRoute.Submit]: [
                    reply(429, errorWire('upstreamRateLimited', 'slow down'), { 'retry-after': '600' }),
                ],
            }),
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.PreparedIntentExpired);
        expect(error.stage).toBe(MarketActionStage.Submit);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
    });
});

describe('the restriction the signed order carries', () => {
    const signedZoneV2 = '0x000056f7000000ece9003ca63978907a00ffd100';

    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('signs a restricted order with a zone for a listing reserved to one buyer', async () => {
        const harness = listCellHarness(routes({ [MarketRoute.Prepare]: [reply(200, reservedPreparedWire())] }));

        const result = parsed(await harness.handler(listCellArgs({ buyerAddress: RESERVED_BUYER })));

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(harness.wallet.signed[0]?.message.orderType).toBe(2);
    });

    it('signs a public listing restricted only by the pinned marketplace signed zone', async () => {
        const prepared = preparedWire({
            order: seaportOrderWire({ orderType: 2, zone: signedZoneV2 }),
        });
        const harness = listCellHarness(routes({ [MarketRoute.Prepare]: [reply(200, prepared)] }));

        const result = parsed(await harness.handler(listCellArgs()));

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(harness.wallet.signed[0]?.message.orderType).toBe(2);
        expect(harness.wallet.signed[0]?.message.zone).toBe(signedZoneV2);
    });

    it.each([
        ['an order anyone may fill', { orderType: 0, zone: `0x${'0'.repeat(40)}` }],
        ['a restricted order with no zone to enforce the reservation', { zone: `0x${'0'.repeat(40)}` }],
    ])('refuses to sign a listing reserved to one buyer that is carried by %s', async (_label, orderOver) => {
        const harness = listCellHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, reservedPreparedWire(orderOver))] }),
        );

        const error = await failure(harness.handler(listCellArgs({ buyerAddress: RESERVED_BUYER })));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });

    it.each([
        ['a zone of its own', { orderType: 2, zone: `0x${'a'.repeat(40)}` }],
        ['no zone at all', { orderType: 2 }],
    ])('refuses to sign a listing anyone may buy that is restricted by %s', async (_label, orderOver) => {
        const harness = listCellHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire({ order: seaportOrderWire(orderOver) }))] }),
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });
});

describe('how many submissions one submit attempt may place on the wire', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        ['the connection drops', new Error('socket hang up')],
        ['the service answers 503', reply(503, errorWire('x', 'down'))],
    ])('reconciles rather than resending the same submission when %s', async (_label, first) => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [EMPTY_PAGE, reply(200, listingsPageWire([publishedListingWire()], null))],
                [MarketRoute.Submit]: [first, reply(400, errorWire('preparedIntentFlowMismatch', 'wrong flow'))],
            }),
        );

        const result = parsed((await settle(harness.handler(listCellArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.AlreadyCompleted);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
        expect(harness.recovery.size()).toBe(0);
    });

    it('keeps the intent when a dropped submission is refused on the next attempt', async () => {
        const recovery = new MarketRecoveryStore();
        const first = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [EMPTY_PAGE],
                [MarketRoute.Submit]: [
                    new Error('socket hang up'),
                    reply(400, errorWire('preparedIntentFlowMismatch', 'wrong flow')),
                ],
            }),
            new FakeSellerWallet(),
            recovery,
        );

        const error = await failure(first.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(first.transport.callsOn(MarketRoute.Submit)).toHaveLength(2);
        expect(recovery.size()).toBe(1);

        const second = listCellHarness(
            routes({ [MarketRoute.Submit]: [reply(200, submittedWire())] }),
            new FakeSellerWallet(),
            recovery,
        );
        const result = parsed((await settle(second.handler(listCellArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(second.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
    });

    it('reconciles a submission refused after re-authentication rather than calling it unpublished', async () => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [EMPTY_PAGE, reply(200, listingsPageWire([publishedListingWire()], null))],
                [MarketRoute.Submit]: [reply(401, errorWire('unauthorized', 'the session is gone'))],
            }),
        );

        const result = parsed((await settle(harness.handler(listCellArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.AlreadyCompleted);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
        expect(harness.recovery.size()).toBe(0);
    });

    it('settles a first submission the server says it never prepared without repeating it', async () => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [EMPTY_PAGE],
                [MarketRoute.Submit]: [reply(400, errorWire('preparedIntentNotFound', 'that prepare is gone'))],
            }),
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
        expect(harness.recovery.size()).toBe(1);
    });

    it('treats a refusal of the second attempt as an outcome the first attempt may already have decided', async () => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [EMPTY_PAGE],
                [MarketRoute.Submit]: [
                    reply(429, errorWire('upstreamRateLimited', 'slow down'), { 'retry-after': '600' }),
                    reply(400, errorWire('preparedIntentFlowMismatch', 'wrong flow')),
                ],
            }),
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(2);
        expect(harness.recovery.size()).toBe(1);
    });

    it('keeps a resumed intent the server refuses, because an earlier call may have published it', async () => {
        const recovery = new MarketRecoveryStore();
        const first = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [EMPTY_PAGE, reply(503, errorWire('x', 'down'))],
                [MarketRoute.Submit]: [
                    reply(429, errorWire('upstreamRateLimited', 'slow down'), { 'retry-after': '600' }),
                ],
            }),
            new FakeSellerWallet(),
            recovery,
        );
        await settle(first.handler(listCellArgs()));
        expect(recovery.size()).toBe(1);

        const second = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [EMPTY_PAGE],
                [MarketRoute.Submit]: [reply(400, errorWire('preparedIntentFlowMismatch', 'wrong flow'))],
            }),
            new FakeSellerWallet(),
            recovery,
        );
        const error = await failure(second.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(second.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
        expect(recovery.size()).toBe(1);
    });

    it('releases the reserved capacity when a listing fails before it is ever submitted', async () => {
        const recovery = new MarketRecoveryStore();
        const harness = listCellHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire({ approvals: [approvalWire(COLLECTION)] }))] }),
            new FakeSellerWallet({ receiptStatus: TxStatus.Reverted }),
            recovery,
        );

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.TransactionReverted);
        expect(recovery.size()).toBe(0);

        const next = listCellHarness(routes(), new FakeSellerWallet(), recovery);
        const result = parsed((await settle(next.handler(listCellArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(next.transport.callsOn(MarketRoute.Prepare)).toHaveLength(1);
    });
});

describe('the bound on unresolved actions', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('refuses the next write with a retryable capacity error instead of evicting an unresolved action', async () => {
        const recovery = new MarketRecoveryStore();
        for (let index = 0; index < MARKET_UNRESOLVED_ACTION_LIMIT; index += 1) {
            recovery.write(`held-${index}`, {
                tool: MarketActionTool.ListCell,
                stage: MarketActionStage.Submit,
                payload: null,
            });
        }
        const harness = listCellHarness(routes(), new FakeSellerWallet(), recovery);

        const error = await failure(harness.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.UnresolvedCapacityFull);
        expect(error.retryable).toBe(true);
        expect(recovery.size()).toBe(MARKET_UNRESOLVED_ACTION_LIMIT);
        expect(recovery.read('held-0')).not.toBeNull();
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
    });
});

describe('the inputs the listing tool accepts', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it.each([
        ['a Cell id with a leading zero', { tokenId: '01234' }],
        ['a fractional price', { price: '1.5' }],
        ['a zero price', { price: '0' }],
        ['an expiry that has already passed', { expirationTime: NOW_SECONDS - 1 }],
        ['a reserved buyer that is not an address', { buyerAddress: 'someone' }],
    ])('rejects %s before any marketplace call', async (_label, over) => {
        const harness = listCellHarness(routes());

        const error = await failure(harness.handler(listCellArgs(over)));

        expect(error.code).toBe(MarketErrorCode.InvalidInput);
        expect(harness.transport.calls).toHaveLength(0);
    });
});
