import { decodeFunctionData, type Abi } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    cancelData,
    cancellationWire,
    cancelOrderArgs,
    cancelOrderHarness,
    FakeMakerWallet,
    FakeTransactionReader,
    MAKER,
    NOW_SECONDS,
    OFFER_ORDER_HASH,
    offerPreparedWire,
    orderCancelledLog,
    orderComponents,
    ORDER_HASH,
    OTHER_CONTRACT,
    OTHER_ORDER_HASH,
    parsed,
    PREPARE_PATH,
    preparedWire,
    reply,
    STRANGER,
    summary,
    TOKEN_ID,
    transportOf,
    txHash,
} from './fixtures.js';
import { SEAPORT_ADDRESS } from '../../../../contracts/seaport.constants.js';
import { errorWire } from '../../../../services/market/__tests__/fixtures.js';
import { SEAPORT_CANCEL_ABI } from '../../../../services/market/cancel.abi.js';
import { MarketError } from '../../../../services/market/error.js';
import { MarketRecoveryStore } from '../../../../services/market/recovery.store.js';
import { MarketSingleFlight } from '../../../../services/market/single-flight.js';
import {
    MarketActionStage,
    MarketActionStatus,
    MarketErrorCode,
    MarketOrderKind,
    MarketTransactionKind,
} from '../../../../services/market/types.js';

async function failure(promise: Promise<unknown>): Promise<MarketError> {
    const outcome = await promise.then(
        () => null,
        (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(MarketError);
    return outcome as MarketError;
}

describe('cancelling one exact Market order', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('one action for both order sides', () => {
        it('cancels the maker own listing with one transaction', async () => {
            const harness = cancelOrderHarness();

            const result = parsed(await harness.handler(cancelOrderArgs()));

            expect(result.status).toBe(MarketActionStatus.Completed);
            expect(result.orderHash).toBe(ORDER_HASH);
            expect(result.orderKind).toBe(MarketOrderKind.Listing);
            expect(result.tokenId).toBe(TOKEN_ID);
            expect(result.wallet).toBe(MAKER);
            expect(result.cancellationTxHash).toBe(txHash(1));
            expect(result.txHashes).toEqual([txHash(1)]);
            expect(harness.wallet.sendCount).toBe(1);
        });

        it('cancels the maker own offer through the very same action and inputs', async () => {
            const wallet = new FakeMakerWallet({ logs: [orderCancelledLog({ orderHash: OFFER_ORDER_HASH })] });
            const harness = cancelOrderHarness(transportOf(reply(200, offerPreparedWire())), { wallet });

            const result = parsed(await harness.handler(cancelOrderArgs({ orderHash: OFFER_ORDER_HASH })));

            expect(result.status).toBe(MarketActionStatus.Completed);
            expect(result.orderKind).toBe(MarketOrderKind.Offer);
            expect(result.tokenId).toBe(TOKEN_ID);
            expect(result.cancellationTxHash).toBe(txHash(1));
        });

        it('asks the game API to prepare exactly the pinned order, once per attempt', async () => {
            const harness = cancelOrderHarness();

            await harness.handler(cancelOrderArgs());

            expect(harness.transport.calls).toHaveLength(1);
            expect(harness.transport.calls[0]?.path).toBe(PREPARE_PATH);
            expect(harness.transport.calls[0]?.method).toBe('POST');
            expect(harness.transport.calls[0]?.body).toEqual({ orderHash: ORDER_HASH });
        });

        it('broadcasts the cancellation bytes it validated, to the pinned protocol contract', async () => {
            const harness = cancelOrderHarness();

            await harness.handler(cancelOrderArgs());

            const sent = harness.wallet.sent[0];
            expect(sent?.to).toBe(SEAPORT_ADDRESS);
            expect(sent?.value).toBe(0n);
            expect(sent?.data).toBe(cancelData());
            expect(
                decodeFunctionData({ abi: SEAPORT_CANCEL_ABI as unknown as Abi, data: sent?.data ?? '0x' })
                    .functionName,
            ).toBe('cancel');
        });
    });

    describe('the maker is enforced before anything is broadcast', () => {
        it('refuses to cancel an order another wallet made', async () => {
            const harness = cancelOrderHarness(
                transportOf(
                    reply(
                        200,
                        preparedWire({
                            transaction: cancellationWire({
                                data: cancelData([orderComponents({ offerer: STRANGER })]),
                            }),
                        }),
                    ),
                ),
            );

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.retryable).toBe(false);
            expect(error.stage).toBe(MarketActionStage.Prepare);
            expect(error.message).toContain(STRANGER);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses calldata that cancels an order another wallet signed', async () => {
            const foreign = cancelData([orderComponents({ offerer: STRANGER })]);
            const wire = preparedWire({ transaction: cancellationWire({ data: foreign }) });
            const harness = cancelOrderHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.message).toContain(STRANGER);
            expect(harness.wallet.sendCount).toBe(0);
        });
    });

    describe('validating the prepared cancellation before it is sent', () => {
        it('refuses a preparation for another chain', async () => {
            const wire = preparedWire({ transaction: cancellationWire({ chainId: 1 }) });
            const harness = cancelOrderHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.ChainMismatch);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a transaction that would be sent on another chain', async () => {
            const wire = preparedWire({ transaction: cancellationWire({ chainId: 8453 }) });
            const harness = cancelOrderHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.ChainMismatch);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a preparation naming another protocol deployment', async () => {
            const harness = cancelOrderHarness(
                transportOf(reply(200, preparedWire({ protocolAddress: OTHER_CONTRACT }))),
            );

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.ProtocolAddressMismatch);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses an order summary naming another protocol deployment', async () => {
            const wire = preparedWire({ protocolAddress: OTHER_CONTRACT });
            const harness = cancelOrderHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.ProtocolAddressMismatch);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a transaction addressed anywhere but the pinned protocol contract', async () => {
            const wire = preparedWire({ transaction: cancellationWire({ to: OTHER_CONTRACT }) });
            const harness = cancelOrderHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.ProtocolAddressMismatch);
            expect(error.message).toContain(OTHER_CONTRACT);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a transaction kind a cancellation never needs', async () => {
            const wire = preparedWire({
                transaction: cancellationWire({ kind: MarketTransactionKind.CollectionApproval }),
            });
            const harness = cancelOrderHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.message).toContain(MarketTransactionKind.CollectionApproval);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses more than one cancellation transaction', async () => {
            const wire = preparedWire({ transaction: [cancellationWire(), cancellationWire()] });
            const harness = cancelOrderHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a preparation with no transaction at all', async () => {
            const harness = cancelOrderHarness(transportOf(reply(200, preparedWire({ transaction: undefined }))));

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it.each([
            ['carries no calldata at all', { data: '0x' }],
            ['is not a cancellation call', { data: '0xdeadbeef' }],
            ['cancels no order', { data: cancelData([]) }],
            [
                'cancels more than the one order named',
                { data: cancelData([orderComponents(), orderComponents({ salt: 77n })]) },
            ],
            ['cancels another order of the same maker', { data: cancelData([orderComponents({ salt: 77n })]) }],
        ])('refuses prepared calldata that %s', async (_label, over) => {
            const wire = preparedWire({ transaction: cancellationWire(over) });
            const harness = cancelOrderHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.retryable).toBe(false);
            expect(error.stage).toBe(MarketActionStage.Prepare);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a cancellation that would send native value', async () => {
            const wire = preparedWire({ transaction: cancellationWire({ value: '1' }) });
            const harness = cancelOrderHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });
    });

    describe('never cancelling another order', () => {
        it('refuses a preparation answering with a different order hash', async () => {
            const wire = preparedWire({ orderHash: OTHER_ORDER_HASH });
            const harness = cancelOrderHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.OrderUnavailable);
            expect(error.message).toContain(OTHER_ORDER_HASH);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('reports an unavailable order from the game API without cancelling anything else', async () => {
            const harness = cancelOrderHarness(
                transportOf(reply(404, errorWire(MarketErrorCode.StaleListing, 'that order is gone'))),
            );

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.StaleListing);
            expect(error.retryable).toBe(false);
            expect(harness.transport.calls).toHaveLength(1);
            expect(harness.wallet.sendCount).toBe(0);
        });
    });

    describe('an inactive order is not proof of a cancellation', () => {
        it('refuses a receipt that carries no cancellation event for the order', async () => {
            const harness = cancelOrderHarness(transportOf(), { wallet: new FakeMakerWallet({ logs: [] }) });

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.txHash).toBe(txHash(1));
        });

        it('refuses a cancellation event another contract emitted', async () => {
            const wallet = new FakeMakerWallet({ logs: [orderCancelledLog({ emitter: OTHER_CONTRACT })] });
            const harness = cancelOrderHarness(transportOf(), { wallet });

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.message).toContain(SEAPORT_ADDRESS);
        });

        it('refuses a cancellation event for another order hash', async () => {
            const wallet = new FakeMakerWallet({ logs: [orderCancelledLog({ orderHash: OTHER_ORDER_HASH })] });
            const harness = cancelOrderHarness(transportOf(), { wallet });

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.message).toContain(ORDER_HASH);
        });

        it('refuses a cancellation event naming another maker', async () => {
            const wallet = new FakeMakerWallet({ logs: [orderCancelledLog({ offerer: STRANGER })] });
            const harness = cancelOrderHarness(transportOf(), { wallet });

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.WrongOwner);
        });

        it('refuses a cancellation transaction another wallet sent', async () => {
            const harness = cancelOrderHarness(transportOf(), { reader: new FakeTransactionReader(STRANGER) });

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.WrongOwner);
            expect(error.message).toContain(STRANGER);
        });

        it('reads the sender of the very transaction it broadcast', async () => {
            const harness = cancelOrderHarness();

            await harness.handler(cancelOrderArgs());

            expect(harness.reader.asked).toEqual([txHash(1)]);
        });

        it('keeps the outcome open when the sending wallet cannot be read back', async () => {
            const harness = cancelOrderHarness(transportOf(), { reader: new FakeTransactionReader(null) });

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
            expect(error.retryable).toBe(true);
            expect(error.txHash).toBe(txHash(1));
            expect(harness.recovery.size()).toBe(1);
        });

        it('drops an unprovable transaction so the maker may cancel again', async () => {
            const harness = cancelOrderHarness(transportOf(), { wallet: new FakeMakerWallet({ logs: [] }) });

            await failure(harness.handler(cancelOrderArgs()));

            expect(harness.recovery.size()).toBe(0);
        });
    });

    describe('when the transaction fails', () => {
        it('reports a reverted cancellation as terminal and keeps no unresolved action', async () => {
            const harness = cancelOrderHarness(transportOf(), { wallet: new FakeMakerWallet({ revertsAt: 1 }) });

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.TransactionReverted);
            expect(error.stage).toBe(MarketActionStage.Cancel);
            expect(error.txHash).toBe(txHash(1));
            expect(harness.recovery.size()).toBe(0);
        });

        it('sends no second cancellation when the broadcast answer is lost', async () => {
            const wallet = new FakeMakerWallet({ sendFailsAt: 1 });
            const harness = cancelOrderHarness(transportOf(), { wallet });

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.NetworkFailure);
            expect(error.retryable).toBe(true);
            expect(error.stage).toBe(MarketActionStage.Cancel);
            expect(wallet.sendCount).toBe(1);
            expect(wallet.log).toEqual(['send:lost']);
        });

        it('keeps a lost broadcast pinned to the same order when the call is repeated', async () => {
            const wallet = new FakeMakerWallet({ sendFailsAt: 1 });
            const transport = transportOf(reply(200, preparedWire()), reply(200, preparedWire()));
            const harness = cancelOrderHarness(transport, { wallet });

            await failure(harness.handler(cancelOrderArgs()));
            const result = parsed(await harness.handler(cancelOrderArgs()));

            expect(result.status).toBe(MarketActionStatus.Completed);
            expect(result.orderHash).toBe(ORDER_HASH);
            expect(transport.calls.map((call) => (call.body as { orderHash: string }).orderHash)).toEqual([
                ORDER_HASH,
                ORDER_HASH,
            ]);
        });

        it('keeps the outcome open when the cancellation receipt cannot be read', async () => {
            const harness = cancelOrderHarness(transportOf(), { wallet: new FakeMakerWallet({ receiptFailsAt: 1 }) });

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
            expect(error.retryable).toBe(true);
            expect(error.txHash).toBe(txHash(1));
            expect(harness.recovery.size()).toBe(1);
        });
    });

    describe('repeating the same intent', () => {
        it('proves the transaction it already sent instead of cancelling a second time', async () => {
            const wallet = new FakeMakerWallet({ receiptFailsAt: 1 });
            const transport = transportOf(reply(200, preparedWire()), reply(200, preparedWire()));
            const harness = cancelOrderHarness(transport, { wallet });

            await failure(harness.handler(cancelOrderArgs()));
            const result = parsed(await harness.handler(cancelOrderArgs()));

            expect(result.status).toBe(MarketActionStatus.AlreadyCompleted);
            expect(result.cancellationTxHash).toBe(txHash(1));
            expect(wallet.sendCount).toBe(1);
            expect(transport.calls).toHaveLength(1);
        });

        it('forgets the cancellation once it is proven, so the next call is a fresh intent', async () => {
            const harness = cancelOrderHarness();

            await harness.handler(cancelOrderArgs());

            expect(harness.recovery.size()).toBe(0);
        });

        it('reports a later unavailable order rather than claiming it cancelled it again', async () => {
            const transport = transportOf(
                reply(200, preparedWire()),
                reply(404, errorWire(MarketErrorCode.StaleListing, 'that order is gone')),
            );
            const harness = cancelOrderHarness(transport);

            await harness.handler(cancelOrderArgs());
            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.StaleListing);
            expect(harness.wallet.sendCount).toBe(1);
        });

        it('shares one operation between identical concurrent calls', async () => {
            const harness = cancelOrderHarness();

            const [first, second] = await Promise.all([
                harness.handler(cancelOrderArgs()),
                harness.handler(cancelOrderArgs()),
            ]);

            expect(parsed(first)).toEqual(parsed(second));
            expect(harness.transport.calls).toHaveLength(1);
            expect(harness.wallet.sendCount).toBe(1);
        });

        it('does not share an operation between different orders', async () => {
            const transport = transportOf(
                reply(200, preparedWire()),
                reply(200, preparedWire({ orderHash: OTHER_ORDER_HASH })),
            );
            const harness = cancelOrderHarness(transport, { singleFlight: new MarketSingleFlight() });

            await Promise.all([
                harness.handler(cancelOrderArgs()),
                failure(harness.handler(cancelOrderArgs({ orderHash: OTHER_ORDER_HASH }))),
            ]);

            expect(transport.calls).toHaveLength(2);
        });

        it('keeps unresolved cancellations inside the process-local store', async () => {
            const recovery = new MarketRecoveryStore();
            const harness = cancelOrderHarness(transportOf(), {
                recovery,
                wallet: new FakeMakerWallet({ receiptFailsAt: 1 }),
            });

            await failure(harness.handler(cancelOrderArgs()));

            expect(recovery.size()).toBe(1);
        });
    });

    describe('the errors it reports', () => {
        it('rejects an order hash that is not a 32-byte value', async () => {
            const harness = cancelOrderHarness();

            const error = await failure(harness.handler(cancelOrderArgs({ orderHash: '0xdeadbeef' })));

            expect(error.code).toBe(MarketErrorCode.InvalidInput);
            expect(harness.transport.calls).toHaveLength(0);
        });

        it('keeps a rate limit carrying a terminal code terminal on this path', async () => {
            const harness = cancelOrderHarness(
                transportOf(
                    reply(429, errorWire(MarketErrorCode.StaleListing, 'that order is gone'), { 'retry-after': '30' }),
                ),
            );

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.StaleListing);
            expect(error.retryable).toBe(false);
            expect(error.retryAfterSeconds).toBe(30);
            expect(harness.transport.calls).toHaveLength(1);
        });

        it('reports a retryable rate limit with its delay and sends nothing', async () => {
            const harness = cancelOrderHarness(transportOf(reply(429, null, { 'retry-after': '12' })));

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.UpstreamRateLimited);
            expect(error.retryable).toBe(true);
            expect(error.retryAfterSeconds).toBe(12);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a created-without-body answer rather than guessing what was prepared', async () => {
            const harness = cancelOrderHarness(transportOf(reply(201, null)));

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.retryable).toBe(false);
            expect(harness.wallet.sendCount).toBe(0);
            expect(harness.recovery.size()).toBe(0);
        });

        it('reports a refused session without sending anything', async () => {
            const harness = cancelOrderHarness(transportOf(reply(401, errorWire('UNAUTHORIZED', 'nope'))));

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.code).toBe(MarketErrorCode.Unauthorized);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('names the stage every failure reached', async () => {
            const wire = preparedWire({
                transaction: cancellationWire({ data: cancelData([orderComponents({ offerer: STRANGER })]) }),
            });
            const harness = cancelOrderHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(cancelOrderArgs()));

            expect(error.stage).toBe(MarketActionStage.Prepare);
            expect(error.message).toContain('stage "prepare"');
        });
    });

    describe('the tool surface', () => {
        it('is registered under its public name with the one input it accepts', () => {
            const harness = cancelOrderHarness();

            expect(harness.name).toBe('cpu_cancel_order');
            expect(Object.keys(harness.inputSchema)).toEqual(['orderHash']);
        });

        it('tells the agent one action serves listings and offers alike', () => {
            const harness = cancelOrderHarness();

            expect(harness.description).toContain('listing');
            expect(harness.description).toContain('offer');
            expect(harness.description).toContain('staleListing');
            expect(harness.description).toContain('staleOffer');
        });

        it('summarizes the cancellation beside the machine-readable result', async () => {
            const harness = cancelOrderHarness();

            const result = await harness.handler(cancelOrderArgs());

            expect(summary(result)).toContain(ORDER_HASH);
            expect(summary(result)).toContain(txHash(1));
            expect(parsed(result).stage).toBe(MarketActionStage.Verify);
        });
    });
});
