import { decodeFunctionData } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    AMOUNT,
    approvalData,
    approvalWire,
    BUYER,
    COLLECTION,
    CONDUIT,
    CONDUIT_KEY,
    COUNTER,
    CURRENCY,
    CURRENCY_ADDRESS,
    EXPIRES_AT,
    FakeAppConfig,
    FakeBuyerWallet,
    FEE_RECIPIENT,
    INTENT_DEADLINE,
    makeOfferArgs,
    makeOfferHarness,
    MarketRoute,
    NATIVE_ADDRESS,
    NATIVE_CURRENCY,
    NOW_SECONDS,
    offersPageWire,
    ORDER_HASH,
    OTHER_CURRENCY,
    parsed,
    PREPARE_ID,
    preparedWire,
    publishedOfferWire,
    reply,
    RoutedMarketTransport,
    seaportOrderWire,
    settle,
    SIGNATURE,
    submittedWire,
    TOKEN_ID,
} from './fixtures.js';
import { ERC20_ABI } from '../../../../contracts/erc20.abi.js';
import { SEAPORT_ADDRESS, SEAPORT_COUNTER_ABI } from '../../../../contracts/seaport.constants.js';
import { WETH_ABI } from '../../../../contracts/weth.abi.js';
import { errorWire } from '../../../../services/market/__tests__/fixtures.js';
import { MarketActionTool } from '../../../../services/market/action.types.js';
import { MARKET_RETRY_BUDGET_MS } from '../../../../services/market/constants.js';
import { MarketError } from '../../../../services/market/error.js';
import {
    MARKET_PROFILE_CACHE_MS,
    MARKET_RECONCILE_MAX_PAGES,
    MARKET_UNRESOLVED_ACTION_LIMIT,
} from '../../../../services/market/recovery.constants.js';
import { MarketRecoveryStore } from '../../../../services/market/recovery.store.js';
import {
    MarketActionStage,
    MarketActionStatus,
    MarketErrorCode,
    MarketOfferKind,
} from '../../../../services/market/types.js';
import { TxStatus } from '../../../../wallet/types.js';

const EMPTY_PAGE = reply(200, offersPageWire([], null));

function routes(over: Partial<Record<MarketRoute, Array<unknown>>> = {}): RoutedMarketTransport {
    return new RoutedMarketTransport({
        [MarketRoute.MyOffers]: [EMPTY_PAGE],
        [MarketRoute.Prepare]: [reply(200, preparedWire())],
        [MarketRoute.Submit]: [reply(200, submittedWire())],
        ...over,
    } as ConstructorParameters<typeof RoutedMarketTransport>[0]);
}

async function failure(promise: Promise<unknown>): Promise<MarketError> {
    return (await settle(promise)) as MarketError;
}

function preparedOrderOver(over: Record<string, unknown>): Record<string, unknown> {
    const order = seaportOrderWire();
    const [payment] = order.offer as Array<Record<string, unknown>>;
    const [cell, ...fees] = order.consideration as Array<Record<string, unknown>>;
    const amount = (over.amount as string | undefined) ?? AMOUNT;
    const currency = (over.currency as typeof NATIVE_CURRENCY | undefined) ?? CURRENCY;
    const criteria = over.kind === MarketOfferKind.Collection || over.kind === MarketOfferKind.Trait;

    return {
        currency,
        order: seaportOrderWire({
            offerer: over.maker ?? BUYER,
            offer: [
                {
                    ...payment,
                    itemType: currency.address === NATIVE_ADDRESS ? 0 : 1,
                    token: currency.address,
                    startAmount: amount,
                    endAmount: amount,
                },
            ],
            consideration: [
                {
                    ...cell,
                    itemType: criteria ? 4 : 2,
                    identifierOrCriteria: criteria ? '0' : (over.tokenId ?? TOKEN_ID),
                },
                ...fees,
            ],
            counter: over.counter ?? COUNTER,
            startTime: String(over.startTime ?? NOW_SECONDS),
            endTime: String(over.expirationTime ?? EXPIRES_AT),
        }),
    };
}

function useFrozenClock(): void {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });
}

describe('publishing an exact-Cell offer', () => {
    useFrozenClock();

    it('reads the counter, prepares, signs and publishes in one call', async () => {
        const harness = makeOfferHarness(routes());

        const result = parsed(await harness.handler(makeOfferArgs()));

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(result.tokenId).toBe(TOKEN_ID);
        expect(result.amount).toBe(AMOUNT);
        expect(result.wallet).toBe(BUYER);
        expect(result.fundingTxHashes).toEqual([]);
        expect(result.approvalTxHashes).toEqual([]);
        expect((result.currency as { symbol: string }).symbol).toBe('WETH');
        expect((result.offer as { orderHash: string }).orderHash).toBe(ORDER_HASH);
        expect((result.offer as { kind: string }).kind).toBe(MarketOfferKind.Item);
    });

    it('validates the prepared order before it checks whether WETH funding is needed', async () => {
        const harness = makeOfferHarness(routes());

        await harness.handler(makeOfferArgs());

        expect(harness.wallet.reads).toHaveLength(2);
        expect(harness.wallet.reads[0]).toEqual({
            address: SEAPORT_ADDRESS,
            abi: SEAPORT_COUNTER_ABI,
            functionName: 'getCounter',
            args: [BUYER],
        });
        expect(harness.wallet.reads[1]).toEqual({
            address: CURRENCY_ADDRESS,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [BUYER],
        });
        expect(harness.wallet.log).toEqual(['read:getCounter', 'read:balanceOf', 'sign']);
    });

    it('sends the counter it read with the prepare request, and never as an agent input', async () => {
        const harness = makeOfferHarness(routes());

        await harness.handler(
            makeOfferArgs({ counter: '999', protocolAddress: `0x${'a'.repeat(40)}`, currency: OTHER_CURRENCY }),
        );

        expect(harness.transport.callsOn(MarketRoute.Prepare)[0]?.body).toEqual({
            tokenId: TOKEN_ID,
            amount: AMOUNT,
            expirationTime: EXPIRES_AT,
            counter: COUNTER,
        });
        expect(Object.keys(harness.inputSchema).sort()).toEqual(['amount', 'expirationTime', 'tokenId']);
    });

    it('submits the returned prepare id with the locally produced signature', async () => {
        const harness = makeOfferHarness(routes());

        await harness.handler(makeOfferArgs());

        expect(harness.transport.callsOn(MarketRoute.Submit)[0]?.body).toEqual({
            prepareId: PREPARE_ID,
            signature: SIGNATURE,
        });
    });

    it('signs the order the protocol verifies, without the transport-only consideration count', async () => {
        const harness = makeOfferHarness(routes());

        await harness.handler(makeOfferArgs());

        const signed = harness.wallet.signed[0];
        const { totalOriginalConsiderationItems: _count, ...expected } = seaportOrderWire();
        expect(signed?.primaryType).toBe('OrderComponents');
        expect(signed?.domain.verifyingContract).toBe('0x0000000000000068F116a894984e2DB1123eB395');
        expect(signed?.domain.chainId).toBe(4663);
        expect(signed?.message).toEqual(expected);
        expect(signed?.message.counter).toBe(COUNTER);
    });

    it('treats the successful submit as authoritative and does not re-read the marketplace afterwards', async () => {
        const harness = makeOfferHarness(routes());

        await harness.handler(makeOfferArgs());

        expect(harness.transport.callsOn(MarketRoute.MyOffers)).toHaveLength(1);
        expect(harness.transport.calls.map((call) => call.path).at(-1)).toContain('/offers/submit');
    });

    it('accepts a submit answered with HTTP 201 Created', async () => {
        const harness = makeOfferHarness(routes({ [MarketRoute.Submit]: [reply(201, submittedWire())] }));

        const result = parsed(await harness.handler(makeOfferArgs()));

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect((result.offer as { orderHash: string }).orderHash).toBe(ORDER_HASH);
    });

    it('reconciles a bodiless HTTP 201 instead of calling the offer unpublished', async () => {
        const harness = makeOfferHarness(
            routes({
                [MarketRoute.MyOffers]: [EMPTY_PAGE, reply(200, offersPageWire([publishedOfferWire()], null))],
                [MarketRoute.Submit]: [reply(201, null)],
            }),
        );

        const result = parsed((await settle(harness.handler(makeOfferArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.AlreadyCompleted);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
        expect(harness.recovery.size()).toBe(0);
    });
});

describe('funding and approving the exact WETH amount an offer owes', () => {
    useFrozenClock();

    it('wraps only the missing ETH after validation and immediately before approval', async () => {
        const wallet = new FakeBuyerWallet({ wethBalance: BigInt(AMOUNT) / 4n });
        const harness = makeOfferHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire({ approvals: [approvalWire()] }))] }),
            wallet,
        );

        const result = parsed(await harness.handler(makeOfferArgs()));

        expect(wallet.log).toEqual([
            'read:getCounter',
            'read:information',
            'read:getConduit',
            'read:balanceOf',
            'read:nativeBalance',
            `send:${CURRENCY_ADDRESS}`,
            `receipt:0x${'1'.repeat(64)}`,
            `send:${CURRENCY_ADDRESS}`,
            `receipt:0x${'2'.repeat(64)}`,
            'sign',
        ]);
        expect(wallet.broadcast[0]).toMatchObject({
            to: CURRENCY_ADDRESS,
            value: BigInt(AMOUNT) - BigInt(AMOUNT) / 4n,
        });
        expect(decodeFunctionData({ abi: WETH_ABI, data: wallet.broadcast[0]?.data ?? '0x' })).toEqual({
            functionName: 'deposit',
            args: undefined,
        });
        expect(wallet.broadcast[1]).toMatchObject({ to: CURRENCY_ADDRESS, value: 0n });
        expect(result.fundingTxHashes).toEqual([`0x${'1'.repeat(64)}`]);
        expect(result.approvalTxHashes).toEqual([`0x${'2'.repeat(64)}`]);
    });

    it('refuses an offer only after the prepared order is validated when ETH cannot cover the WETH deficit', async () => {
        const wallet = new FakeBuyerWallet({ wethBalance: BigInt(AMOUNT) - 1n, nativeBalance: 1n });
        const harness = makeOfferHarness(routes(), wallet);

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.InsufficientBalance);
        expect(error.message).toContain(`has ${BigInt(AMOUNT) - 1n} WETH base units and 1 native base units`);
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(1);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
        expect(wallet.broadcast).toHaveLength(0);
        expect(wallet.signed).toHaveLength(0);
    });

    it('stops at a reverted wrap before approval, signing or publication', async () => {
        const wallet = new FakeBuyerWallet({ wethBalance: 0n, receiptStatus: TxStatus.Reverted });
        const harness = makeOfferHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire({ approvals: [approvalWire()] }))] }),
            wallet,
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.TransactionReverted);
        expect(error.stage).toBe(MarketActionStage.Approve);
        expect(error.txHash).toBe(`0x${'1'.repeat(64)}`);
        expect(wallet.broadcast).toHaveLength(1);
        expect(wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });

    it('broadcasts approvals in the returned order and observes each receipt before signing', async () => {
        const harness = makeOfferHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire({ approvals: [approvalWire()] }))] }),
        );

        const result = parsed(await harness.handler(makeOfferArgs()));

        expect(harness.wallet.log).toEqual([
            'read:getCounter',
            'read:information',
            'read:getConduit',
            'read:balanceOf',
            `send:${CURRENCY_ADDRESS}`,
            `receipt:0x${'1'.repeat(64)}`,
            'sign',
        ]);
        expect(result.approvalTxHashes).toEqual([`0x${'1'.repeat(64)}`]);
    });

    it('stops at a reverted approval and never signs or publishes the offer', async () => {
        const harness = makeOfferHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire({ approvals: [approvalWire()] }))] }),
            new FakeBuyerWallet({ receiptStatus: TxStatus.Reverted }),
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.TransactionReverted);
        expect(error.stage).toBe(MarketActionStage.Approve);
        expect(error.txHash).toBe(`0x${'1'.repeat(64)}`);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });

    it.each([
        ['approves more than the offer is worth', { data: approvalData('2000000000000000000') }],
        ['approves less than the offer is worth', { data: approvalData('1') }],
        ['approves a currency the offer is not priced in', { to: `0x${'9'.repeat(40)}` }],
        ['is not an approval at all', { data: '0xdeadbeef' }],
        ['carries an approval selector with no arguments behind it', { data: '0x095ea7b3' }],
        ['approves a spender the settling conduit is not', { data: approvalData(AMOUNT, `0x${'a'.repeat(40)}`) }],
        ['sends the chain currency along with an approval', { value: '1' }],
        ['runs on another chain', { chainId: 1 }],
        ['is not a currency approval', { kind: 'collectionApproval' }],
    ])('refuses a prepared transaction that %s', async (_label, over) => {
        const harness = makeOfferHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire({ approvals: [approvalWire(over)] }))] }),
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.log).not.toContain(`send:${CURRENCY_ADDRESS}`);
        expect(harness.wallet.signed).toHaveLength(0);
    });

    it('broadcasts an approval of the exact offer amount for the conduit that settles the signed order', async () => {
        const harness = makeOfferHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire({ approvals: [approvalWire()] }))] }),
        );

        await harness.handler(makeOfferArgs());

        const broadcast = harness.wallet.broadcast;
        expect(broadcast).toHaveLength(1);
        expect(broadcast[0]?.to?.toLowerCase()).toBe(CURRENCY_ADDRESS.toLowerCase());
        expect(decodeFunctionData({ abi: ERC20_ABI, data: broadcast[0]?.data ?? '0x' })).toEqual({
            functionName: 'approve',
            args: [CONDUIT, BigInt(AMOUNT)],
        });
        expect(harness.wallet.reads.find((read) => read.functionName === 'getConduit')?.args).toEqual([CONDUIT_KEY]);
    });

    it('refuses to approve when the protocol disowns the conduit key the order names', async () => {
        const harness = makeOfferHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire({ approvals: [approvalWire()] }))] }),
            new FakeBuyerWallet({ conduit: null }),
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.broadcast).toHaveLength(0);
        expect(harness.wallet.signed).toHaveLength(0);
    });

    it('keeps the offer unsigned and retryable when the protocol cannot be read', async () => {
        const harness = makeOfferHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire({ approvals: [approvalWire()] }))] }),
            new FakeBuyerWallet({ protocolReadFails: true }),
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.NetworkFailure);
        expect(error.retryable).toBe(true);
        expect(harness.wallet.broadcast).toHaveLength(0);
    });
});

describe('the local checks a prepared offer must pass', () => {
    useFrozenClock();

    it.each([
        ['another chain', { chainId: 1 }, MarketErrorCode.ChainMismatch],
        [
            'another protocol contract',
            { protocolAddress: `0x${'7'.repeat(40)}` },
            MarketErrorCode.ProtocolAddressMismatch,
        ],
        ['another maker', preparedOrderOver({ maker: `0x${'8'.repeat(40)}` }), MarketErrorCode.WrongOwner],
        [
            'an offerer that is not this wallet',
            { order: seaportOrderWire({ offerer: `0x${'8'.repeat(40)}` }) },
            MarketErrorCode.WrongOwner,
        ],
        ['another Cell', preparedOrderOver({ tokenId: '999' }), MarketErrorCode.InvalidMarketResponse],
        ['another amount', preparedOrderOver({ amount: '5' }), MarketErrorCode.InvalidMarketResponse],
        [
            'another expiry',
            preparedOrderOver({ expirationTime: EXPIRES_AT + 60 }),
            MarketErrorCode.InvalidMarketResponse,
        ],
        ['a stale counter', preparedOrderOver({ counter: '6' }), MarketErrorCode.InvalidMarketResponse],
        [
            'a collection offer',
            preparedOrderOver({ kind: MarketOfferKind.Collection }),
            MarketErrorCode.InvalidMarketResponse,
        ],
        ['a trait offer', preparedOrderOver({ kind: MarketOfferKind.Trait }), MarketErrorCode.InvalidMarketResponse],
        [
            'a start time an hour away',
            preparedOrderOver({ startTime: NOW_SECONDS + 3_600 }),
            MarketErrorCode.InvalidMarketResponse,
        ],
        [
            'the chain currency, which an offer cannot be made in',
            preparedOrderOver({ currency: NATIVE_CURRENCY }),
            MarketErrorCode.CurrencyUnsupported,
        ],
    ])('refuses a prepared offer that names %s', async (_label, over, code) => {
        const harness = makeOfferHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire(over as Record<string, unknown>))] }),
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(code);
        expect(harness.wallet.reads.some((read) => read.functionName === 'balanceOf')).toBe(false);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });

    it('refuses to prepare at all when the Cell collection is not configured for this network', async () => {
        const harness = makeOfferHarness(
            routes(),
            new FakeBuyerWallet(),
            new MarketRecoveryStore(),
            new FakeAppConfig('the-cell-collection-is-missing'),
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
        expect(harness.wallet.signed).toHaveLength(0);
    });

    it('refuses to prepare at all when WETH is not configured for this network', async () => {
        const harness = makeOfferHarness(
            routes(),
            new FakeBuyerWallet(),
            new MarketRecoveryStore(),
            new FakeAppConfig(COLLECTION, 'the-weth-token-is-missing'),
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(error.message).toContain('WETH is not configured');
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
        expect(harness.wallet.reads).toHaveLength(0);
        expect(harness.wallet.signed).toHaveLength(0);
    });

    it('reports a counter the protocol contract will not answer as a retryable failure', async () => {
        const harness = makeOfferHarness(routes(), new FakeBuyerWallet({ counter: null }));

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.NetworkFailure);
        expect(error.retryable).toBe(true);
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
        expect(harness.recovery.size()).toBe(0);
    });
});

function offerItemWire(over: Record<string, unknown>): Array<Record<string, unknown>> {
    const offer = seaportOrderWire().offer as Array<Record<string, unknown>>;
    return [{ ...offer[0], ...over }];
}

function considerationWire(index: number, over: Record<string, unknown>): Array<Record<string, unknown>> {
    const consideration = seaportOrderWire().consideration as Array<Record<string, unknown>>;
    return consideration.map((item, at) => (at === index ? { ...item, ...over } : item));
}

describe('the complete order an offer asks the wallet to sign', () => {
    useFrozenClock();

    it.each([
        ['offers nothing at all', { order: seaportOrderWire({ offer: [] }) }],
        [
            'offers two currency items',
            { order: seaportOrderWire({ offer: [...offerItemWire({}), ...offerItemWire({})] }) },
        ],
        [
            'offers a currency the prepared offer is not priced in',
            { order: seaportOrderWire({ offer: offerItemWire({ token: `0x${'d'.repeat(40)}` }) }) },
        ],
        [
            'offers an amount other than the requested one',
            { order: seaportOrderWire({ offer: offerItemWire({ startAmount: '5', endAmount: '5' }) }) },
        ],
        [
            'offers an amount that grows over time',
            { order: seaportOrderWire({ offer: offerItemWire({ endAmount: '2000000000000000000' }) }) },
        ],
        [
            'offers an item kind the currency is not',
            { order: seaportOrderWire({ offer: offerItemWire({ itemType: 2 }) }) },
        ],
        [
            'asks for a Cell of another collection',
            { order: seaportOrderWire({ consideration: considerationWire(0, { token: `0x${'d'.repeat(40)}` }) }) },
        ],
        [
            'asks for another Cell',
            { order: seaportOrderWire({ consideration: considerationWire(0, { identifierOrCriteria: '999' }) }) },
        ],
        [
            'asks for a Cell by criteria rather than by id',
            { order: seaportOrderWire({ consideration: considerationWire(0, { itemType: 4 }) }) },
        ],
        [
            'sends the Cell to another wallet',
            { order: seaportOrderWire({ consideration: considerationWire(0, { recipient: FEE_RECIPIENT }) }) },
        ],
        [
            'asks for more than one unit of the Cell',
            { order: seaportOrderWire({ consideration: considerationWire(0, { startAmount: '2', endAmount: '2' }) }) },
        ],
        [
            'asks for no Cell at all',
            {
                order: seaportOrderWire({
                    consideration: [(seaportOrderWire().consideration as Array<object>)[1]],
                    totalOriginalConsiderationItems: 1,
                }),
            },
        ],
        [
            'pays a fee in another currency',
            { order: seaportOrderWire({ consideration: considerationWire(1, { token: `0x${'d'.repeat(40)}` }) }) },
        ],
        [
            'pays a fee larger than the whole offer',
            {
                order: seaportOrderWire({
                    consideration: considerationWire(1, {
                        startAmount: '2000000000000000000',
                        endAmount: '2000000000000000000',
                    }),
                }),
            },
        ],
        [
            'pays a fee that grows over time',
            { order: seaportOrderWire({ consideration: considerationWire(1, { endAmount: '30000000000000000' }) }) },
        ],
        [
            'declares a consideration count it does not carry',
            { order: seaportOrderWire({ totalOriginalConsiderationItems: 3 }) },
        ],
        ['is a partially fillable order', { order: seaportOrderWire({ orderType: 1 }) }],
        ['is a contract order', { order: seaportOrderWire({ orderType: 4 }) }],
        [
            'ends later than the requested expiry',
            { order: seaportOrderWire({ endTime: (EXPIRES_AT + 60).toString() }) },
        ],
        [
            'starts at a time the prepared offer does not carry',
            { order: seaportOrderWire({ startTime: '9999999999' }) },
        ],
        ['carries a counter the prepared offer does not', { order: seaportOrderWire({ counter: '6' }) }],
    ])('refuses to sign an order that %s', async (_label, over) => {
        const harness = makeOfferHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire(over as Record<string, unknown>))] }),
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });

    it('signs an offer whose whole amount reaches the seller because nothing is charged', async () => {
        const prepared = preparedWire({
            order: seaportOrderWire({
                consideration: [(seaportOrderWire().consideration as Array<object>)[0]],
                totalOriginalConsiderationItems: 1,
            }),
        });
        const harness = makeOfferHarness(routes({ [MarketRoute.Prepare]: [reply(200, prepared)] }));

        const result = parsed(await harness.handler(makeOfferArgs()));

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(harness.wallet.signed).toHaveLength(1);
    });

    it('signs a restricted order, which can only narrow who may fill it', async () => {
        const prepared = preparedWire({ order: seaportOrderWire({ orderType: 2, zone: `0x${'a'.repeat(40)}` }) });
        const harness = makeOfferHarness(routes({ [MarketRoute.Prepare]: [reply(200, prepared)] }));

        const result = parsed(await harness.handler(makeOfferArgs()));

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(harness.wallet.signed[0]?.message.orderType).toBe(2);
    });

    it('accepts fees that add up to exactly the amount offered', async () => {
        const prepared = preparedWire({
            order: seaportOrderWire({
                consideration: considerationWire(1, { startAmount: AMOUNT, endAmount: AMOUNT }),
            }),
        });
        const harness = makeOfferHarness(routes({ [MarketRoute.Prepare]: [reply(200, prepared)] }));

        const result = parsed(await harness.handler(makeOfferArgs()));

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(harness.wallet.signed).toHaveLength(1);
    });
});

describe('the deadline a prepared offer stops at', () => {
    useFrozenClock();

    it('refuses to sign a prepared intent that is already past its own deadline', async () => {
        const harness = makeOfferHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire({ expiresAt: NOW_SECONDS - 1 }))] }),
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.PreparedIntentExpired);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });

    it('stops at the offer expiry when it falls before the prepared-intent deadline', async () => {
        const shortExpiry = NOW_SECONDS + 60;
        const prepared = preparedWire({
            ...preparedOrderOver({ expirationTime: shortExpiry }),
            approvals: [approvalWire()],
        });
        const harness = makeOfferHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, prepared)] }),
            new FakeBuyerWallet({ clockJumpMs: 120_000 }),
        );

        const error = await failure(harness.handler(makeOfferArgs({ expirationTime: shortExpiry })));

        expect(error.code).toBe(MarketErrorCode.PreparedIntentExpired);
        expect(error.stage).toBe(MarketActionStage.Sign);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(0);
    });

    it('checks the deadline again before every submit attempt', async () => {
        const harness = makeOfferHarness(
            routes({
                [MarketRoute.Prepare]: [reply(200, preparedWire({ expiresAt: NOW_SECONDS + 5 }))],
                [MarketRoute.Submit]: [new Error('socket hang up')],
            }),
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.PreparedIntentExpired);
        expect(error.stage).toBe(MarketActionStage.Submit);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
    });
});

describe('two callers asking for the same offer at once', () => {
    useFrozenClock();

    it('share one operation instead of publishing two orders', async () => {
        const harness = makeOfferHarness(routes());

        const [left, right] = await Promise.all([harness.handler(makeOfferArgs()), harness.handler(makeOfferArgs())]);

        expect(parsed(left).status).toBe(MarketActionStatus.Completed);
        expect(parsed(right)).toEqual(parsed(left));
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(1);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
        expect(harness.wallet.reads).toHaveLength(2);
    });
});

describe('an equivalent offer that is already active', () => {
    useFrozenClock();

    it('is returned as already completed instead of being published a second time', async () => {
        const harness = makeOfferHarness(
            routes({ [MarketRoute.MyOffers]: [reply(200, offersPageWire([publishedOfferWire()], null))] }),
        );

        const result = parsed(await harness.handler(makeOfferArgs()));

        expect(result.status).toBe(MarketActionStatus.AlreadyCompleted);
        expect((result.offer as { orderHash: string }).orderHash).toBe(ORDER_HASH);
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
        expect(harness.wallet.signed).toHaveLength(0);
        expect(harness.recovery.size()).toBe(0);
    });

    it('pages on until it finds the equivalent offer', async () => {
        const harness = makeOfferHarness(
            routes({
                [MarketRoute.MyOffers]: [
                    reply(200, offersPageWire([publishedOfferWire({ tokenId: '77' })], 'page-2')),
                    reply(200, offersPageWire([publishedOfferWire()], null)),
                ],
            }),
        );

        const result = parsed(await harness.handler(makeOfferArgs()));

        expect(result.status).toBe(MarketActionStatus.AlreadyCompleted);
        expect(harness.transport.callsOn(MarketRoute.MyOffers)).toHaveLength(2);
    });

    it.each([
        ['another amount', { amount: '7' }],
        ['another expiry', { expirationTime: EXPIRES_AT + 60 }],
        ['another maker', { maker: `0x${'8'.repeat(40)}` }],
        ['another Cell', { tokenId: '77' }],
        ['no bound Cell at all', { kind: MarketOfferKind.Collection, tokenId: null }],
        ['a trait rather than this Cell', { kind: MarketOfferKind.Trait, tokenId: null }],
    ])('does not mistake an offer of mine at %s for this intent', async (_label, over) => {
        const harness = makeOfferHarness(
            routes({ [MarketRoute.MyOffers]: [reply(200, offersPageWire([publishedOfferWire(over)], null))] }),
        );

        const result = parsed(await harness.handler(makeOfferArgs()));

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(1);
    });

    it('refuses a fresh prepare when the active offers do not fit in the pages it may read', async () => {
        const harness = makeOfferHarness(
            routes({ [MarketRoute.MyOffers]: [reply(200, offersPageWire([], 'another-page'))] }),
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(error.retryable).toBe(true);
        expect(harness.transport.callsOn(MarketRoute.MyOffers)).toHaveLength(MARKET_RECONCILE_MAX_PAGES);
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
    });
});

describe('a submit whose outcome is uncertain', () => {
    useFrozenClock();

    it('reconciles the marketplace and reports the offer it finds as already completed', async () => {
        const harness = makeOfferHarness(
            routes({
                [MarketRoute.MyOffers]: [EMPTY_PAGE, reply(200, offersPageWire([publishedOfferWire()], null))],
                [MarketRoute.Submit]: [new Error('socket hang up')],
            }),
        );

        const result = parsed((await settle(harness.handler(makeOfferArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.AlreadyCompleted);
        expect((result.offer as { orderHash: string }).orderHash).toBe(ORDER_HASH);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
        expect(harness.recovery.size()).toBe(0);
    });

    it('places exactly one submission on the wire per attempt, whatever the transport does', async () => {
        const harness = makeOfferHarness(
            routes({
                [MarketRoute.MyOffers]: [EMPTY_PAGE, reply(200, offersPageWire([publishedOfferWire()], null))],
                [MarketRoute.Submit]: [new Error('socket hang up')],
            }),
        );

        const result = parsed((await settle(harness.handler(makeOfferArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.AlreadyCompleted);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
    });

    it('does not repeat a submission a rate limit refused with a terminal code', async () => {
        const harness = makeOfferHarness(
            routes({
                [MarketRoute.MyOffers]: [EMPTY_PAGE, EMPTY_PAGE],
                [MarketRoute.Submit]: [
                    reply(429, errorWire('preparedIntentNotFound', 'that prepare is gone')),
                    reply(200, submittedWire()),
                ],
            }),
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
        expect(harness.recovery.size()).toBe(1);
    });

    it('surfaces a first-attempt upstream rejection directly and releases its recovery record', async () => {
        const harness = makeOfferHarness(
            routes({
                [MarketRoute.MyOffers]: [EMPTY_PAGE],
                [MarketRoute.Submit]: [
                    reply(422, {
                        success: false,
                        error: 'upstreamRejected',
                        message: 'The offer cannot be published because the wallet has too little WETH.',
                        reqId: 'request-123',
                    }),
                ],
            }),
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.UpstreamRejected);
        expect(error.retryable).toBe(false);
        expect(error.message).toContain('Diagnostic id: request-123.');
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
        expect(harness.recovery.size()).toBe(0);
    });

    it('does not accept an offer in another currency as the one it may have published', async () => {
        const harness = makeOfferHarness(
            routes({
                [MarketRoute.MyOffers]: [
                    EMPTY_PAGE,
                    reply(200, offersPageWire([publishedOfferWire({ currency: OTHER_CURRENCY })], null)),
                ],
                [MarketRoute.Submit]: [new Error('socket hang up')],
            }),
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(error.retryable).toBe(true);
        expect(harness.recovery.size()).toBe(1);
    });

    it('waits for the read snapshot to advance before it calls the offer absent, then resubmits the same intent', async () => {
        const harness = makeOfferHarness(
            routes({
                [MarketRoute.MyOffers]: [EMPTY_PAGE, EMPTY_PAGE],
                [MarketRoute.Submit]: [new Error('socket hang up'), reply(200, submittedWire())],
            }),
        );
        const startedAt = Date.now();

        const result = parsed((await settle(harness.handler(makeOfferArgs()))) as never);
        const submits = harness.transport.callsOn(MarketRoute.Submit);

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(submits).toHaveLength(2);
        expect(submits[1]?.body).toEqual(submits[0]?.body);
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(1);
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(MARKET_PROFILE_CACHE_MS);
    });

    it('never repeats a submission the service told it to hold off on for longer than the wait budget', async () => {
        const harness = makeOfferHarness(
            routes({
                [MarketRoute.MyOffers]: [EMPTY_PAGE, EMPTY_PAGE],
                [MarketRoute.Submit]: [
                    reply(429, errorWire('upstreamRateLimited', 'slow down'), { 'retry-after': '600' }),
                    reply(200, submittedWire()),
                ],
            }),
        );
        const startedAt = Date.now();

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(error.retryable).toBe(true);
        expect(error.retryAfterSeconds).toBe(600);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
        expect(Date.now() - startedAt).toBeLessThan(600_000);
        expect(harness.recovery.size()).toBe(1);
    });

    it('honours a short delay in full before it repeats the submission', async () => {
        const harness = makeOfferHarness(
            routes({
                [MarketRoute.MyOffers]: [EMPTY_PAGE, EMPTY_PAGE],
                [MarketRoute.Submit]: [
                    reply(429, errorWire('upstreamRateLimited', 'slow down'), { 'retry-after': '30' }),
                    reply(200, submittedWire()),
                ],
            }),
        );
        const startedAt = Date.now();

        const result = parsed((await settle(harness.handler(makeOfferArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(2);
        expect(Date.now() - startedAt).toBeGreaterThanOrEqual(30_000);
        expect(Date.now() - startedAt).toBeLessThan(MARKET_RETRY_BUDGET_MS + MARKET_PROFILE_CACHE_MS);
    });

    it('drops the intent when the server refused the submission before it could publish anything', async () => {
        const recovery = new MarketRecoveryStore();
        const first = makeOfferHarness(
            routes({
                [MarketRoute.Submit]: [reply(400, errorWire('preparedIntentFlowMismatch', 'wrong flow'))],
            }),
            new FakeBuyerWallet(),
            recovery,
        );

        const error = await failure(first.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.PreparedIntentFlowMismatch);
        expect(first.transport.callsOn(MarketRoute.MyOffers)).toHaveLength(1);
        expect(recovery.size()).toBe(0);
    });

    it('reconciles a submission refused after re-authentication rather than calling it unpublished', async () => {
        const harness = makeOfferHarness(
            routes({
                [MarketRoute.MyOffers]: [EMPTY_PAGE, reply(200, offersPageWire([publishedOfferWire()], null))],
                [MarketRoute.Submit]: [reply(401, errorWire('unauthorized', 'the session is gone'))],
            }),
        );

        const result = parsed((await settle(harness.handler(makeOfferArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.AlreadyCompleted);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
        expect(harness.recovery.size()).toBe(0);
    });

    it('resumes the retained intent on the next call rather than preparing a second order', async () => {
        const recovery = new MarketRecoveryStore();
        const first = makeOfferHarness(
            routes({
                [MarketRoute.MyOffers]: [EMPTY_PAGE, reply(503, errorWire('x', 'down'))],
                [MarketRoute.Submit]: [new Error('socket hang up')],
            }),
            new FakeBuyerWallet(),
            recovery,
        );
        const held = await failure(first.handler(makeOfferArgs()));

        expect(held.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(recovery.size()).toBe(1);

        const second = makeOfferHarness(
            routes({ [MarketRoute.Submit]: [reply(200, submittedWire())] }),
            new FakeBuyerWallet(),
            recovery,
        );
        const result = parsed((await settle(second.handler(makeOfferArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.Completed);
        expect(second.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
        expect(second.wallet.reads).toEqual([]);
        expect(second.transport.callsOn(MarketRoute.Submit)[0]?.body).toEqual({
            prepareId: PREPARE_ID,
            signature: SIGNATURE,
        });
        expect(recovery.size()).toBe(0);
    });

    it('reconciles an expired prepared intent before it will let a fresh offer be prepared', async () => {
        const recovery = new MarketRecoveryStore();
        await settle(
            makeOfferHarness(
                routes({
                    [MarketRoute.MyOffers]: [EMPTY_PAGE, reply(503, errorWire('x', 'down'))],
                    [MarketRoute.Submit]: [new Error('socket hang up')],
                }),
                new FakeBuyerWallet(),
                recovery,
            ).handler(makeOfferArgs()),
        );
        vi.setSystemTime((INTENT_DEADLINE + 1) * 1_000);

        const later = makeOfferHarness(
            routes({ [MarketRoute.MyOffers]: [reply(200, offersPageWire([publishedOfferWire()], null))] }),
            new FakeBuyerWallet(),
            recovery,
        );
        const result = parsed((await settle(later.handler(makeOfferArgs()))) as never);

        expect(result.status).toBe(MarketActionStatus.AlreadyCompleted);
        expect(later.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
        expect(recovery.size()).toBe(0);
    });

    it('keeps an expired prepared intent when the marketplace is unavailable, rather than recreating it', async () => {
        const recovery = new MarketRecoveryStore();
        await settle(
            makeOfferHarness(
                routes({
                    [MarketRoute.MyOffers]: [EMPTY_PAGE, reply(503, errorWire('x', 'down'))],
                    [MarketRoute.Submit]: [new Error('socket hang up')],
                }),
                new FakeBuyerWallet(),
                recovery,
            ).handler(makeOfferArgs()),
        );
        vi.setSystemTime((INTENT_DEADLINE + 1) * 1_000);

        const later = makeOfferHarness(
            routes({ [MarketRoute.MyOffers]: [reply(503, errorWire('x', 'down'))] }),
            new FakeBuyerWallet(),
            recovery,
        );
        const error = await failure(later.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(later.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
        expect(recovery.size()).toBe(1);
    });

    it('keeps the intent when a terminal code answers a resubmission the server may have published', async () => {
        const recovery = new MarketRecoveryStore();
        const harness = makeOfferHarness(
            routes({
                [MarketRoute.MyOffers]: [EMPTY_PAGE],
                [MarketRoute.Submit]: [
                    new Error('socket hang up'),
                    reply(400, errorWire('preparedIntentNotFound', 'that prepare is gone')),
                ],
            }),
            new FakeBuyerWallet(),
            recovery,
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(2);
        expect(recovery.size()).toBe(1);
    });

    it('calls the outcome unknown when the reconcile scan cannot reach the end of the offers', async () => {
        const harness = makeOfferHarness(
            routes({
                [MarketRoute.MyOffers]: [EMPTY_PAGE, reply(200, offersPageWire([], 'another-page'))],
                [MarketRoute.Submit]: [new Error('socket hang up')],
            }),
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(harness.transport.callsOn(MarketRoute.Submit)).toHaveLength(1);
        expect(harness.recovery.size()).toBe(1);
    });

    it('releases the reserved capacity when an offer fails before it is ever submitted', async () => {
        const recovery = new MarketRecoveryStore();
        const harness = makeOfferHarness(
            routes({ [MarketRoute.Prepare]: [reply(200, preparedWire({ approvals: [approvalWire()] }))] }),
            new FakeBuyerWallet({ receiptStatus: TxStatus.Reverted }),
            recovery,
        );

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.TransactionReverted);
        expect(recovery.size()).toBe(0);
    });
});

describe('the bound on unresolved actions', () => {
    useFrozenClock();

    it('refuses the next write with a retryable capacity error instead of evicting an unresolved action', async () => {
        const recovery = new MarketRecoveryStore();
        for (let index = 0; index < MARKET_UNRESOLVED_ACTION_LIMIT; index += 1) {
            recovery.write(`held-${index}`, {
                tool: MarketActionTool.MakeCellOffer,
                stage: MarketActionStage.Submit,
                payload: null,
            });
        }
        const harness = makeOfferHarness(routes(), new FakeBuyerWallet(), recovery);

        const error = await failure(harness.handler(makeOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.UnresolvedCapacityFull);
        expect(error.retryable).toBe(true);
        expect(recovery.size()).toBe(MARKET_UNRESOLVED_ACTION_LIMIT);
        expect(recovery.read('held-0')).not.toBeNull();
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(0);
    });
});

describe('the inputs the offer tool accepts', () => {
    useFrozenClock();

    it.each([
        ['a Cell id with a leading zero', { tokenId: '01234' }],
        ['a fractional amount', { amount: '1.5' }],
        ['a zero amount', { amount: '0' }],
        ['an expiry that has already passed', { expirationTime: NOW_SECONDS - 1 }],
    ])('rejects %s before any marketplace call', async (_label, over) => {
        const harness = makeOfferHarness(routes());

        const error = await failure(harness.handler(makeOfferArgs(over)));

        expect(error.code).toBe(MarketErrorCode.InvalidInput);
        expect(harness.transport.calls).toHaveLength(0);
        expect(harness.wallet.reads).toHaveLength(0);
    });

    it('accepts a positive WETH amount without imposing decimal-price increments', async () => {
        const amount = (BigInt(AMOUNT) - 1n).toString();
        const harness = makeOfferHarness(
            routes({
                [MarketRoute.Prepare]: [reply(200, preparedWire(preparedOrderOver({ amount })))],
                [MarketRoute.Submit]: [
                    reply(
                        200,
                        submittedWire({
                            price: {
                                currencyAddress: CURRENCY.address,
                                symbol: CURRENCY.symbol,
                                decimals: CURRENCY.decimals,
                                amountBaseUnits: amount,
                            },
                        }),
                    ),
                ],
            }),
        );

        const result = parsed(await harness.handler(makeOfferArgs({ amount })));

        expect(result.amount).toBe(amount);
        expect(harness.transport.callsOn(MarketRoute.Prepare)).toHaveLength(1);
    });

    it('describes itself as an exact-Cell item offer that never creates trait or collection offers', () => {
        const harness = makeOfferHarness(routes());

        expect(harness.description).toContain('one exact Cell');
        expect(harness.description.toLowerCase()).toContain('already_completed');
    });
});

describe('the summary the offer tool prints for an agent', () => {
    useFrozenClock();

    it('names the Cell, the amount, the currency and the order', async () => {
        const harness = makeOfferHarness(routes());

        const result = await harness.handler(makeOfferArgs());

        expect(result.content[0]?.text).toContain(`Cell ${TOKEN_ID}`);
        expect(result.content[0]?.text).toContain(ORDER_HASH);
        expect(result.content[0]?.text).toContain('WETH');
        expect(result.content[0]?.text).toContain(AMOUNT);
    });
});
