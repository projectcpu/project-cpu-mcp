import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    approvalWire,
    COLLECTION,
    CREATOR_FEE,
    EXPIRES_AT,
    FakeSellerWallet,
    INTENT_DEADLINE,
    listCellArgs,
    listCellHarness,
    listingsPageWire,
    MarketRoute,
    NOW_SECONDS,
    ORDER_HASH,
    PLATFORM_FEE,
    PREPARE_ID,
    PRICE,
    preparedWire,
    PROCEEDS,
    publishedListingWire,
    parsed,
    reply,
    RESERVED_BUYER,
    RoutedMarketTransport,
    seaportOrderWire,
    settle,
    submittedWire,
    TOKEN_ID,
} from './fixtures.js';
import { MarketActionTool } from '../../../../services/market/action.types.js';
import { MarketError } from '../../../../services/market/error.js';
import {
    MARKET_PROFILE_CACHE_MS,
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
        const prepared = preparedWire({
            listing: { ...(preparedWire().listing as object), buyerAddress: RESERVED_BUYER },
        });
        const harness = listCellHarness(routes({ [MarketRoute.Prepare]: [reply(200, prepared)] }));

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
        expect(signed?.domain.chainId).toBe(4663);
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
        const other = `0x${'9'.repeat(40)}`;
        const harness = listCellHarness(
            routes({
                [MarketRoute.Prepare]: [
                    reply(200, preparedWire({ transactions: [approvalWire(COLLECTION), approvalWire(other)] })),
                ],
            }),
        );

        const result = parsed(await harness.handler(listCellArgs()));

        expect(harness.wallet.log).toEqual([
            `send:${COLLECTION}`,
            `receipt:0x${'1'.repeat(64)}`,
            `send:${other}`,
            `receipt:0x${'2'.repeat(64)}`,
            'sign',
        ]);
        expect(result.approvalTxHashes).toEqual([`0x${'1'.repeat(64)}`, `0x${'2'.repeat(64)}`]);
    });

    it('stops at a reverted approval and never signs or publishes the order', async () => {
        const harness = listCellHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire({ transactions: [approvalWire(COLLECTION)] }))] }),
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
            fees: { platformFee: '0', creatorFee: '0', estimatedProceeds: PRICE },
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
            fees: { platformFee: PLATFORM_FEE, creatorFee: CREATOR_FEE, estimatedProceeds: PRICE },
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
        [
            'another seller',
            { listing: { ...(preparedWire().listing as object), maker: `0x${'8'.repeat(40)}` } },
            MarketErrorCode.WrongOwner,
        ],
        [
            'another Cell',
            { listing: { ...(preparedWire().listing as object), tokenId: '999' } },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'another price',
            { listing: { ...(preparedWire().listing as object), price: '5' } },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'another expiry',
            { listing: { ...(preparedWire().listing as object), expirationTime: EXPIRES_AT + 60 } },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'a reserved buyer nobody asked for',
            { listing: { ...(preparedWire().listing as object), buyerAddress: RESERVED_BUYER } },
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'a currency approval a listing never needs',
            { transactions: [{ ...approvalWire(COLLECTION), kind: 'currencyApproval' }] },
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
            listing: { ...(preparedWire().listing as object), expirationTime: shortExpiry },
            order: seaportOrderWire({ endTime: shortExpiry.toString() }),
            transactions: [approvalWire(COLLECTION)],
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

    it('does not mistake a listing of the same Cell at another price for this intent', async () => {
        const harness = listCellHarness(
            routes({
                [MarketRoute.MyListings]: [reply(200, listingsPageWire([publishedListingWire({ price: '7' })], null))],
            }),
        );

        const result = parsed(await harness.handler(listCellArgs()));

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(1);
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
                    reply(429, { code: 'upstreamRateLimited', message: 'slow down' }, { 'retry-after': '600' }),
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
                [MarketRoute.MyListings]: [EMPTY_PAGE, reply(503, { code: 'x', message: 'down' })],
                [MarketRoute.Submit]: [
                    reply(429, { code: 'upstreamRateLimited', message: 'slow down' }, { 'retry-after': '600' }),
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
            [MarketRoute.MyListings]: [EMPTY_PAGE, reply(503, { code: 'x', message: 'down' })],
            [MarketRoute.Submit]: [
                reply(429, { code: 'upstreamRateLimited', message: 'slow down' }, { 'retry-after': '600' }),
            ],
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
            [MarketRoute.MyListings]: [EMPTY_PAGE, reply(503, { code: 'x', message: 'down' })],
            [MarketRoute.Submit]: [
                reply(429, { code: 'upstreamRateLimited', message: 'slow down' }, { 'retry-after': '600' }),
            ],
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
            [MarketRoute.MyListings]: [EMPTY_PAGE, reply(503, { code: 'x', message: 'down' })],
            [MarketRoute.Submit]: [
                reply(429, { code: 'upstreamRateLimited', message: 'slow down' }, { 'retry-after': '600' }),
            ],
        });
        const recovery = new MarketRecoveryStore();
        await settle(listCellHarness(transport, new FakeSellerWallet(), recovery).handler(listCellArgs()));
        vi.setSystemTime((INTENT_DEADLINE + 1) * 1_000);

        const later = listCellHarness(
            routes({ [MarketRoute.MyListings]: [reply(503, { code: 'x', message: 'down' })] }),
            new FakeSellerWallet(),
            recovery,
        );
        const error = await failure(later.handler(listCellArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(later.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
        expect(recovery.size()).toBe(1);
    });

    it('drops the intent after a terminal submit failure, so the next call may prepare a new order', async () => {
        const recovery = new MarketRecoveryStore();
        const first = listCellHarness(
            routes({
                [MarketRoute.Submit]: [reply(400, { code: 'preparedIntentFlowMismatch', message: 'wrong flow' })],
            }),
            new FakeSellerWallet(),
            recovery,
        );

        const error = await failure(first.handler(listCellArgs()));
        expect(error.code).toBe(MarketErrorCode.PreparedIntentFlowMismatch);
        expect(recovery.size()).toBe(0);

        const second = listCellHarness(routes(), new FakeSellerWallet(), recovery);
        const result = parsed((await settle(second.handler(listCellArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(second.transport.callsOn(MarketRoute.Prepare)).toHaveLength(1);
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
