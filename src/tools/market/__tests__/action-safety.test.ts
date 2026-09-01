import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SEAPORT_ADDRESS } from '../../../contracts/seaport.constants.js';
import { MarketError } from '../../../services/market/error.js';
import { MarketActionStage, MarketErrorCode } from '../../../services/market/types.js';
import {
    acceptOfferArgs,
    acceptOfferHarness,
    approvalWire,
    COLLECTION,
    FakeSellerWallet,
    FakeTransactionReader,
    orderFulfilledLog,
    OTHER_TOKEN_ID,
    STRANGER,
    fulfilmentWire,
    NOW_SECONDS,
    offerWire,
    OTHER_CONTRACT,
    preparedWire,
    reply,
    transportOf,
} from '../accept-offer/__tests__/fixtures.js';
import {
    buyCellArgs,
    buyCellHarness,
    FakeBuyerWallet,
    FakeTransactionReader as BuyTransactionReader,
    fulfilmentWire as buyFulfilmentWire,
    orderFulfilledLog as buyOrderFulfilledLog,
    OTHER_TOKEN_ID as BUY_OTHER_TOKEN_ID,
    STRANGER as BUY_STRANGER,
    OTHER_CONTRACT as BUY_OTHER_CONTRACT,
    preparedWire as buyPreparedWire,
    reply as buyReply,
    transportOf as buyTransportOf,
} from '../buy-cell/__tests__/fixtures.js';
import {
    cancelOrderArgs,
    cancelOrderHarness,
    FakeMakerWallet,
    preparedWire as cancelPreparedWire,
    reply as cancelReply,
    transportOf as cancelTransportOf,
    txHash,
} from '../cancel-order/__tests__/fixtures.js';

async function failure(promise: Promise<unknown>): Promise<MarketError> {
    const outcome = await promise.then(
        () => null,
        (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(MarketError);
    return outcome as MarketError;
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1_000);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('every collection approval an acceptance broadcasts', () => {
    it('is broadcast, and there are exactly as many of them as the preparation carried', async () => {
        const harness = acceptOfferHarness(
            transportOf(reply(200, preparedWire({ transactions: [approvalWire(), approvalWire(), fulfilmentWire()] }))),
        );

        await harness.handler(acceptOfferArgs());

        const approvals = harness.wallet.sent.filter((sent) => sent.to === COLLECTION);
        expect(approvals).toHaveLength(2);
        expect(harness.wallet.sent).toHaveLength(3);
        expect(harness.wallet.sent[2]?.to).toBe(SEAPORT_ADDRESS);
    });

    it('is validated first — a second approval to a stranger contract stops the whole call', async () => {
        const harness = acceptOfferHarness(
            transportOf(
                reply(
                    200,
                    preparedWire({
                        transactions: [approvalWire(), approvalWire({ to: OTHER_CONTRACT }), fulfilmentWire()],
                    }),
                ),
            ),
        );

        const error = await failure(harness.handler(acceptOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(error.retryable).toBe(false);
        expect(harness.wallet.sent).toEqual([]);
    });
});

describe('the pinned protocol contract of an acceptance', () => {
    it('is required on the preparation itself', async () => {
        const harness = acceptOfferHarness(transportOf(reply(200, preparedWire({ protocolAddress: OTHER_CONTRACT }))));

        const error = await failure(harness.handler(acceptOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.ProtocolAddressMismatch);
        expect(harness.wallet.sent).toEqual([]);
    });

    it('is required on the offer it names, even when the preparation names the right one', async () => {
        const harness = acceptOfferHarness(
            transportOf(reply(200, preparedWire({ offer: offerWire({ protocolAddress: OTHER_CONTRACT }) }))),
        );

        const error = await failure(harness.handler(acceptOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.ProtocolAddressMismatch);
        expect(harness.wallet.sent).toEqual([]);
    });
});

describe('where a prepared fulfilment is allowed to send the wallet', () => {
    it('is the pinned protocol contract and nowhere else, when selling', async () => {
        const harness = acceptOfferHarness(
            transportOf(
                reply(200, preparedWire({ transactions: [approvalWire(), fulfilmentWire({ to: OTHER_CONTRACT })] })),
            ),
        );

        const error = await failure(harness.handler(acceptOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(error.message).toContain(SEAPORT_ADDRESS);
        expect(harness.wallet.sent).toEqual([]);
    });

    it('is the pinned protocol contract and nowhere else, when buying', async () => {
        const harness = buyCellHarness(
            buyTransportOf(
                buyReply(200, buyPreparedWire({ transactions: [buyFulfilmentWire({ to: BUY_OTHER_CONTRACT })] })),
            ),
        );

        const error = await failure(harness.handler(buyCellArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(error.message).toContain(SEAPORT_ADDRESS);
        expect(harness.wallet.sent).toEqual([]);
    });
});

describe('a marketplace transaction the chain reverted', () => {
    it('ends an acceptance as a terminal failure, never as something safe to repeat', async () => {
        const harness = acceptOfferHarness(transportOf(), {
            wallet: new FakeSellerWallet({ revertsAt: 2 }),
        });

        const error = await failure(harness.handler(acceptOfferArgs()));

        expect(error.retryable).toBe(false);
        expect(error.code).toBe(MarketErrorCode.TransactionReverted);
        expect(error.stage).toBe(MarketActionStage.Fulfil);
    });

    it('ends a cancellation as a terminal failure, never as something safe to repeat', async () => {
        const harness = cancelOrderHarness(cancelTransportOf(), { wallet: new FakeMakerWallet({ revertsAt: 1 }) });

        const error = await failure(harness.handler(cancelOrderArgs()));

        expect(error.retryable).toBe(false);
        expect(error.code).toBe(MarketErrorCode.TransactionReverted);
        expect(error.txHash).toBe(txHash(1));
    });
});

describe('which Cell the settled order is proven to have moved', () => {
    it('refuses a sale whose own fulfilment event names another Cell of this wallet', async () => {
        const harness = acceptOfferHarness(transportOf(), {
            wallet: new FakeSellerWallet({ logs: [orderFulfilledLog({ cell: OTHER_TOKEN_ID })] }),
        });

        const error = await failure(harness.handler(acceptOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.WrongOwner);
        expect(error.retryable).toBe(false);
        expect(error.message).toContain(OTHER_TOKEN_ID);
    });

    it('refuses a purchase whose own fulfilment event names another Cell', async () => {
        const harness = buyCellHarness(buyTransportOf(), {
            wallet: new FakeBuyerWallet({ logs: [buyOrderFulfilledLog({ cell: BUY_OTHER_TOKEN_ID })] }),
        });

        const error = await failure(harness.handler(buyCellArgs()));

        expect(error.code).toBe(MarketErrorCode.WrongOwner);
        expect(error.retryable).toBe(false);
        expect(error.message).toContain(BUY_OTHER_TOKEN_ID);
    });
});

describe('the bounded slot an unprovable fulfilment holds', () => {
    it('is released when the proof fails terminally, so the intent is not stranded for the process', async () => {
        const harness = acceptOfferHarness(transportOf(), { reader: new FakeTransactionReader(STRANGER) });

        const error = await failure(harness.handler(acceptOfferArgs()));

        expect(error.retryable).toBe(false);
        expect(harness.recovery.size()).toBe(0);
    });

    it('is kept while the outcome is still unknown, so a retry re-checks that same transaction', async () => {
        const harness = acceptOfferHarness(transportOf(), { reader: new FakeTransactionReader(null) });

        const error = await failure(harness.handler(acceptOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(error.retryable).toBe(true);
        expect(harness.recovery.size()).toBe(1);
    });

    it('is released on a terminally unprovable purchase too', async () => {
        const harness = buyCellHarness(buyTransportOf(), { reader: new BuyTransactionReader(BUY_STRANGER) });

        const error = await failure(harness.handler(buyCellArgs()));

        expect(error.retryable).toBe(false);
        expect(harness.recovery.size()).toBe(0);
    });
});

describe('the wire fields an action refuses to loosen', () => {
    it('rejects a prepared Cell id carrying a leading zero, so one Cell keeps one identity', async () => {
        const harness = acceptOfferHarness(transportOf(reply(200, preparedWire({ tokenId: '01234' }))));

        const error = await failure(harness.handler(acceptOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.sent).toEqual([]);
    });

    it('rejects currency decimals outside the backend wire bound', async () => {
        const offered = offerWire();
        const harness = acceptOfferHarness(
            transportOf(
                reply(
                    200,
                    preparedWire({
                        offer: {
                            ...offered,
                            price: { ...(offered.price as Record<string, unknown>), decimals: 37 },
                        },
                    }),
                ),
            ),
        );

        const error = await failure(harness.handler(acceptOfferArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.sent).toEqual([]);
    });

    it('rejects a cancellation whose protocol address is malformed', async () => {
        const harness = cancelOrderHarness(
            cancelTransportOf(cancelReply(200, cancelPreparedWire({ protocolAddress: 'not-an-address' }))),
        );

        const error = await failure(harness.handler(cancelOrderArgs()));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(harness.wallet.sendCount).toBe(0);
    });
});
