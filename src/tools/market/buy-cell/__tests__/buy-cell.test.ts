import { decodeFunctionData, zeroAddress } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    approvalData,
    approvalWire,
    BARE_APPROVAL_SELECTOR,
    buyCellArgs,
    buyCellHarness,
    BUYER,
    COLLECTION,
    CONDUIT,
    OTHER_CONTRACT,
    CURRENCY_ADDRESS,
    ERC20_CURRENCY,
    erc20PreparedWire,
    FakeAppConfig,
    FakeBuyerWallet,
    FakeTransactionReader,
    fulfilmentWire,
    listingWire,
    MAX_AMOUNT,
    NOW_SECONDS,
    orderFulfilledLog,
    ORDER_HASH,
    OTHER_ORDER_HASH,
    OTHER_TOKEN_ID,
    parsed,
    PREPARE_PATH,
    preparedWire,
    PRICE,
    reply,
    SELLER,
    STRANGER,
    summary,
    TOKEN_ID,
    transportOf,
    txHash,
} from './fixtures.js';
import { ERC20_ABI } from '../../../../contracts/erc20.abi.js';
import { SEAPORT_ADDRESS } from '../../../../contracts/seaport.constants.js';
import { errorWire } from '../../../../services/market/__tests__/fixtures.js';
import { MarketError } from '../../../../services/market/error.js';
import { MarketRecoveryStore } from '../../../../services/market/recovery.store.js';
import { MarketSingleFlight } from '../../../../services/market/single-flight.js';
import {
    MarketActionStage,
    MarketActionStatus,
    MarketErrorCode,
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

describe('buying one exact Cell listing', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('the transactions it sends', () => {
        it('pays a native listing with one fulfilment transaction and no approval', async () => {
            const harness = buyCellHarness();

            const result = parsed(await harness.handler(buyCellArgs()));

            expect(result.status).toBe(MarketActionStatus.Completed);
            expect(result.orderHash).toBe(ORDER_HASH);
            expect(result.tokenId).toBe(TOKEN_ID);
            expect(result.seller).toBe(SELLER);
            expect(result.price).toBe(PRICE);
            expect(result.approvalTxHashes).toEqual([]);
            expect(result.fulfilmentTxHash).toBe(txHash(1));
            expect(result.txHashes).toEqual([txHash(1)]);
            expect(harness.wallet.sent).toHaveLength(1);
            expect(harness.wallet.sent[0]?.value).toBe(BigInt(PRICE));
        });

        it('sends the currency approval and waits for it before the ERC-20 fulfilment', async () => {
            const harness = buyCellHarness(transportOf(reply(200, erc20PreparedWire())));

            const result = parsed(await harness.handler(buyCellArgs()));

            expect(harness.wallet.log).toEqual([
                'read:information',
                'read:getKey',
                `send:${CURRENCY_ADDRESS}:0`,
                `receipt:${txHash(1)}`,
                `send:${SEAPORT_ADDRESS}:0`,
                `receipt:${txHash(2)}`,
                'read:ownerOf',
            ]);
            expect(result.approvalTxHashes).toEqual([txHash(1)]);
            expect(result.fulfilmentTxHash).toBe(txHash(2));
            expect(result.txHashes).toEqual([txHash(1), txHash(2)]);
            expect(result.currency).toEqual(ERC20_CURRENCY);
        });

        it('accepts a zero-valued ERC-20 fulfilment and a positive native value alike', async () => {
            const erc20 = buyCellHarness(transportOf(reply(200, erc20PreparedWire())));
            const native = buyCellHarness();

            await erc20.handler(buyCellArgs());
            await native.handler(buyCellArgs());

            expect(erc20.wallet.sent.map((tx) => tx.value)).toEqual([0n, 0n]);
            expect(native.wallet.sent.map((tx) => tx.value)).toEqual([BigInt(PRICE)]);
        });

        it('accepts the canonical purchase wire returned by the game API', async () => {
            const harness = buyCellHarness(transportOf(reply(200, preparedWire())));

            const result = parsed(await harness.handler(buyCellArgs()));

            expect(result.status).toBe(MarketActionStatus.Completed);
            expect(result.orderHash).toBe(ORDER_HASH);
            expect(harness.wallet.sent).toHaveLength(1);
        });

        it('asks the game API to prepare exactly the pinned order, once per attempt', async () => {
            const harness = buyCellHarness();

            await harness.handler(buyCellArgs());

            expect(harness.transport.calls).toHaveLength(1);
            expect(harness.transport.calls[0]?.path).toBe(PREPARE_PATH);
            expect(harness.transport.calls[0]?.method).toBe('POST');
            expect(harness.transport.calls[0]?.body).toEqual({
                tokenId: TOKEN_ID,
                expectedOrderHash: ORDER_HASH,
                maxAmount: MAX_AMOUNT,
            });
        });
    });

    describe('the spending ceiling', () => {
        it('buys an order priced exactly at the ceiling', async () => {
            const wire = preparedWire({
                listing: listingWire({ price: MAX_AMOUNT }),
                transactions: [fulfilmentWire({ value: MAX_AMOUNT })],
            });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const result = parsed(await harness.handler(buyCellArgs()));

            expect(result.status).toBe(MarketActionStatus.Completed);
            expect(result.price).toBe(MAX_AMOUNT);
        });

        it('refuses an order one base unit above the ceiling without sending anything', async () => {
            const dearer = (BigInt(MAX_AMOUNT) + 1n).toString();
            const wire = preparedWire({
                listing: listingWire({ price: dearer }),
                transactions: [fulfilmentWire({ value: dearer })],
            });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.OrderUnavailable);
            expect(error.retryable).toBe(false);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses prepared transactions that would send more native value than the ceiling', async () => {
            const wire = preparedWire({
                transactions: [fulfilmentWire({ value: (BigInt(MAX_AMOUNT) + 1n).toString() })],
            });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.OrderUnavailable);
            expect(harness.wallet.sendCount).toBe(0);
        });
    });

    describe('never substituting another order', () => {
        it('refuses a prepared purchase of a different order hash, however good it looks', async () => {
            const cheaper = preparedWire({
                listing: listingWire({ orderHash: OTHER_ORDER_HASH, price: '1' }),
                transactions: [fulfilmentWire({ value: '1' })],
            });
            const harness = buyCellHarness(transportOf(reply(200, cheaper)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.OrderUnavailable);
            expect(error.message).toContain(OTHER_ORDER_HASH);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a prepared purchase of a different Cell', async () => {
            const wire = preparedWire({ listing: listingWire({ tokenId: OTHER_TOKEN_ID }) });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses an order that already expired', async () => {
            const wire = preparedWire({ listing: listingWire({ expirationTime: NOW_SECONDS - 1 }) });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.OrderUnavailable);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses an order that is not fillable yet', async () => {
            const wire = preparedWire({ listing: listingWire({ startTime: NOW_SECONDS + 3_600 }) });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.OrderUnavailable);
        });

        it('reports an unavailable order from the game API without looking for a replacement', async () => {
            const harness = buyCellHarness(
                transportOf(reply(404, errorWire(MarketErrorCode.StaleListing, 'that order is gone'))),
            );

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.StaleListing);
            expect(error.retryable).toBe(false);
            expect(harness.transport.calls).toHaveLength(1);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses to buy a listing this wallet made itself', async () => {
            const wire = preparedWire({ listing: listingWire({ maker: BUYER }) });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.WrongOwner);
            expect(harness.wallet.sendCount).toBe(0);
        });
    });

    describe('validating the prepared work before signing anything away', () => {
        it('refuses a transaction that would be sent on another chain', async () => {
            const wire = preparedWire({ transactions: [fulfilmentWire({ chainId: 8453 })] });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.ChainMismatch);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a preparation naming another protocol deployment', async () => {
            const wire = preparedWire({ listing: listingWire({ protocolAddress: OTHER_CONTRACT }) });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.ProtocolAddressMismatch);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a transaction kind a purchase never needs', async () => {
            const wire = erc20PreparedWire({
                transactions: [
                    approvalWire({ kind: MarketTransactionKind.CollectionApproval }),
                    fulfilmentWire({ value: '0' }),
                ],
            });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.message).toContain(MarketTransactionKind.CollectionApproval);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a sequence that does not end with the fulfilment', async () => {
            const wire = erc20PreparedWire({ transactions: [fulfilmentWire({ value: '0' }), approvalWire()] });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses two fulfilment transactions for one order', async () => {
            const wire = preparedWire({ transactions: [fulfilmentWire({ value: '0' }), fulfilmentWire()] });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses an approval pointed at anything but the listing currency', async () => {
            const wire = erc20PreparedWire({
                transactions: [approvalWire({ to: STRANGER }), fulfilmentWire({ value: '0' })],
            });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.message).toContain(STRANGER);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it.each([
            ['carries an approval selector with no arguments behind it', { data: BARE_APPROVAL_SELECTOR }],
            ['is not an approval at all', { data: '0xdeadbeef' }],
            ['approves more than the listing costs', { data: approvalData(MAX_AMOUNT) }],
            ['approves an unlimited allowance', { data: approvalData((2n ** 256n - 1n).toString()) }],
            ['approves less than the listing costs', { data: approvalData('1') }],
            ['approves a spender the protocol does not know', { data: approvalData(PRICE, STRANGER) }],
        ])('refuses a prepared currency approval that %s', async (_label, over) => {
            const wire = erc20PreparedWire({
                transactions: [approvalWire(over), fulfilmentWire({ value: '0' })],
            });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses an approval whose spender the protocol registry disowns', async () => {
            const harness = buyCellHarness(transportOf(reply(200, erc20PreparedWire())), {
                wallet: new FakeBuyerWallet({ conduitKnown: false }),
            });

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.message).toContain(CONDUIT);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('pays nothing and stays retryable when the protocol cannot be read', async () => {
            const harness = buyCellHarness(transportOf(reply(200, erc20PreparedWire())), {
                wallet: new FakeBuyerWallet({ protocolReadFails: true }),
            });

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.NetworkFailure);
            expect(error.retryable).toBe(true);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('broadcasts the approval bytes it validated, for the exact listing price', async () => {
            const harness = buyCellHarness(transportOf(reply(200, erc20PreparedWire())));

            await harness.handler(buyCellArgs());

            expect(decodeFunctionData({ abi: ERC20_ABI, data: harness.wallet.sent[0]?.data ?? '0x' })).toEqual({
                functionName: 'approve',
                args: [CONDUIT, BigInt(PRICE)],
            });
        });

        it('refuses a currency approval for an order paid in the native coin', async () => {
            const wire = preparedWire({ transactions: [approvalWire(), fulfilmentWire()] });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses native value attached to an order priced in an ERC-20', async () => {
            const wire = erc20PreparedWire({ transactions: [approvalWire(), fulfilmentWire({ value: '5' })] });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a fulfilment that carries no calldata', async () => {
            const wire = preparedWire({ transactions: [fulfilmentWire({ data: '0x' })] });
            const harness = buyCellHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a preparation with no transactions at all', async () => {
            const harness = buyCellHarness(transportOf(reply(200, preparedWire({ transactions: [] }))));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });
    });

    describe('proving the purchase from the receipt', () => {
        it('refuses a fulfilment event emitted by another contract', async () => {
            const wallet = new FakeBuyerWallet({ logs: [orderFulfilledLog({ emitter: OTHER_CONTRACT })] });
            const harness = buyCellHarness(transportOf(), { wallet });

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.message).toContain(SEAPORT_ADDRESS);
            expect(error.txHash).toBe(txHash(1));
        });

        it('refuses a fulfilment event for another order hash', async () => {
            const wallet = new FakeBuyerWallet({ logs: [orderFulfilledLog({ orderHash: OTHER_ORDER_HASH })] });
            const harness = buyCellHarness(transportOf(), { wallet });

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.message).toContain(ORDER_HASH);
        });

        it('refuses a fulfilment transaction another wallet sent', async () => {
            const harness = buyCellHarness(transportOf(), { reader: new FakeTransactionReader(STRANGER) });

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.WrongOwner);
            expect(error.message).toContain(STRANGER);
        });

        it('refuses a fulfilment that handed the Cell to another address', async () => {
            const wallet = new FakeBuyerWallet({ logs: [orderFulfilledLog({ recipient: STRANGER })] });
            const harness = buyCellHarness(transportOf(), { wallet });

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.WrongOwner);
        });

        it('reads the sender of the fulfilment transaction it broadcast', async () => {
            const harness = buyCellHarness();

            await harness.handler(buyCellArgs());

            expect(harness.reader.asked).toEqual([txHash(1)]);
        });

        it('refuses to claim the purchase when the Cell ends up owned by somebody else', async () => {
            const harness = buyCellHarness(transportOf(), { wallet: new FakeBuyerWallet({ owner: STRANGER }) });

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.WrongOwner);
            expect(error.message).toContain(STRANGER);
            expect(error.txHash).toBe(txHash(1));
        });

        it('checks ownership on the configured Cell collection', async () => {
            const harness = buyCellHarness();

            await harness.handler(buyCellArgs());

            expect(harness.wallet.reads[0]?.address.toLowerCase()).toBe(COLLECTION.toLowerCase());
            expect(harness.wallet.reads[0]?.functionName).toBe('ownerOf');
            expect(harness.wallet.reads[0]?.args).toEqual([BigInt(TOKEN_ID)]);
        });

        it('never reaches the ownership check when the order event is missing', async () => {
            const harness = buyCellHarness(transportOf(), { wallet: new FakeBuyerWallet({ logs: [] }) });

            await failure(harness.handler(buyCellArgs()));

            expect(harness.wallet.reads).toHaveLength(0);
        });

        it('keeps the outcome open when ownership cannot be read back', async () => {
            const harness = buyCellHarness(transportOf(), { wallet: new FakeBuyerWallet({ readFails: true }) });

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
            expect(error.retryable).toBe(true);
            expect(error.txHash).toBe(txHash(1));
            expect(harness.recovery.size()).toBe(1);
        });

        it('refuses to trust an unconfigured Cell collection', async () => {
            const harness = buyCellHarness(transportOf(), { appConfig: new FakeAppConfig('') });

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        });
    });

    describe('when a transaction fails', () => {
        it('stops at a reverted currency approval and never sends the fulfilment', async () => {
            const wallet = new FakeBuyerWallet({ revertsAt: 1 });
            const harness = buyCellHarness(transportOf(reply(200, erc20PreparedWire())), { wallet });

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.TransactionReverted);
            expect(error.stage).toBe(MarketActionStage.Approve);
            expect(error.txHash).toBe(txHash(1));
            expect(wallet.sendCount).toBe(1);
            expect(harness.recovery.size()).toBe(0);
        });

        it('reports a reverted fulfilment as terminal and keeps no unresolved purchase', async () => {
            const harness = buyCellHarness(transportOf(), { wallet: new FakeBuyerWallet({ revertsAt: 1 }) });

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.TransactionReverted);
            expect(error.stage).toBe(MarketActionStage.Fulfil);
            expect(error.txHash).toBe(txHash(1));
            expect(harness.recovery.size()).toBe(0);
        });

        it('preserves every known transaction hash when the fulfilment reverts after an approval', async () => {
            const wallet = new FakeBuyerWallet({ revertsAt: 2 });
            const harness = buyCellHarness(transportOf(reply(200, erc20PreparedWire())), { wallet });

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.message).toContain(txHash(1));
            expect(error.message).toContain(txHash(2));
        });

        it('sends no second fulfilment when the broadcast answer is lost', async () => {
            const wallet = new FakeBuyerWallet({ sendFailsAt: 1 });
            const harness = buyCellHarness(transportOf(), { wallet });

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.NetworkFailure);
            expect(error.retryable).toBe(true);
            expect(error.stage).toBe(MarketActionStage.Fulfil);
            expect(wallet.sendCount).toBe(1);
            expect(wallet.log).toEqual(['send:lost']);
        });

        it('keeps a lost broadcast pinned to the same order when the call is repeated', async () => {
            const wallet = new FakeBuyerWallet({ sendFailsAt: 1 });
            const transport = transportOf(reply(200, preparedWire()), reply(200, preparedWire()));
            const harness = buyCellHarness(transport, { wallet });

            await failure(harness.handler(buyCellArgs()));
            const result = parsed(await harness.handler(buyCellArgs()));

            expect(result.status).toBe(MarketActionStatus.Completed);
            expect(result.orderHash).toBe(ORDER_HASH);
            expect(
                transport.calls.map((call) => (call.body as { expectedOrderHash: string }).expectedOrderHash),
            ).toEqual([ORDER_HASH, ORDER_HASH]);
        });

        it('keeps the outcome open when the fulfilment receipt cannot be read', async () => {
            const harness = buyCellHarness(transportOf(), { wallet: new FakeBuyerWallet({ receiptFailsAt: 1 }) });

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
            expect(error.retryable).toBe(true);
            expect(error.txHash).toBe(txHash(1));
            expect(harness.recovery.size()).toBe(1);
        });
    });

    describe('repeating the same intent', () => {
        it('proves the transaction it already sent instead of buying a second time', async () => {
            const wallet = new FakeBuyerWallet({ receiptFailsAt: 1 });
            const transport = transportOf(reply(200, preparedWire()), reply(200, preparedWire()));
            const harness = buyCellHarness(transport, { wallet });

            await failure(harness.handler(buyCellArgs()));
            const result = parsed(await harness.handler(buyCellArgs()));

            expect(result.status).toBe(MarketActionStatus.AlreadyCompleted);
            expect(result.fulfilmentTxHash).toBe(txHash(1));
            expect(wallet.sendCount).toBe(1);
            expect(transport.calls).toHaveLength(1);
        });

        it('forgets the purchase once it is proven, so the next call is a fresh intent', async () => {
            const harness = buyCellHarness();

            await harness.handler(buyCellArgs());

            expect(harness.recovery.size()).toBe(0);
        });

        it('shares one operation between identical concurrent calls', async () => {
            const harness = buyCellHarness();

            const [first, second] = await Promise.all([harness.handler(buyCellArgs()), harness.handler(buyCellArgs())]);

            expect(parsed(first)).toEqual(parsed(second));
            expect(harness.transport.calls).toHaveLength(1);
            expect(harness.wallet.sendCount).toBe(1);
        });

        it('does not share an operation between different orders', async () => {
            const transport = transportOf(
                reply(200, preparedWire()),
                reply(200, preparedWire({ listing: listingWire({ orderHash: OTHER_ORDER_HASH }) })),
            );
            const harness = buyCellHarness(transport, { singleFlight: new MarketSingleFlight() });

            await Promise.all([
                harness.handler(buyCellArgs()),
                failure(harness.handler(buyCellArgs({ expectedOrderHash: OTHER_ORDER_HASH }))),
            ]);

            expect(transport.calls).toHaveLength(2);
        });

        it('keeps unresolved purchases inside the process-local store', async () => {
            const recovery = new MarketRecoveryStore();
            const harness = buyCellHarness(transportOf(), {
                recovery,
                wallet: new FakeBuyerWallet({ receiptFailsAt: 1 }),
            });

            await failure(harness.handler(buyCellArgs()));

            expect(recovery.size()).toBe(1);
        });
    });

    describe('the errors it reports', () => {
        it('rejects a token id that is not canonical', async () => {
            const harness = buyCellHarness();

            const error = await failure(harness.handler(buyCellArgs({ tokenId: '01234' })));

            expect(error.code).toBe(MarketErrorCode.InvalidInput);
            expect(harness.transport.calls).toHaveLength(0);
        });

        it('rejects an order hash that is not a 32-byte value', async () => {
            const harness = buyCellHarness();

            const error = await failure(harness.handler(buyCellArgs({ expectedOrderHash: '0xdeadbeef' })));

            expect(error.code).toBe(MarketErrorCode.InvalidInput);
            expect(harness.transport.calls).toHaveLength(0);
        });

        it('rejects a ceiling of zero', async () => {
            const harness = buyCellHarness();

            const error = await failure(harness.handler(buyCellArgs({ maxAmount: '0' })));

            expect(error.code).toBe(MarketErrorCode.InvalidInput);
            expect(harness.transport.calls).toHaveLength(0);
        });

        it('keeps a rate limit carrying a terminal code terminal on this money path', async () => {
            const harness = buyCellHarness(
                transportOf(
                    reply(429, errorWire(MarketErrorCode.StaleListing, 'that order is gone'), { 'retry-after': '30' }),
                ),
            );

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.StaleListing);
            expect(error.retryable).toBe(false);
            expect(error.retryAfterSeconds).toBe(30);
            expect(harness.transport.calls).toHaveLength(1);
        });

        it('reports a retryable rate limit with its delay and sends nothing', async () => {
            const harness = buyCellHarness(transportOf(reply(429, null, { 'retry-after': '12' })));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.UpstreamRateLimited);
            expect(error.retryable).toBe(true);
            expect(error.retryAfterSeconds).toBe(12);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a created-without-body answer rather than guessing what was prepared', async () => {
            const harness = buyCellHarness(transportOf(reply(201, null)));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.retryable).toBe(false);
            expect(harness.wallet.sendCount).toBe(0);
            expect(harness.recovery.size()).toBe(0);
        });

        it('reports a refused session without sending anything', async () => {
            const harness = buyCellHarness(transportOf(reply(401, errorWire('UNAUTHORIZED', 'nope'))));

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.code).toBe(MarketErrorCode.Unauthorized);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('names the stage every failure reached', async () => {
            const harness = buyCellHarness(
                transportOf(reply(200, preparedWire({ listing: listingWire({ price: '9' + MAX_AMOUNT }) }))),
            );

            const error = await failure(harness.handler(buyCellArgs()));

            expect(error.stage).toBe(MarketActionStage.Prepare);
            expect(error.message).toContain('stage "prepare"');
        });
    });

    describe('the tool surface', () => {
        it('is registered under its public name with the three inputs it accepts', () => {
            const harness = buyCellHarness();

            expect(harness.tool.name).toBe('cpu_buy_cell');
            expect(Object.keys(harness.tool.inputSchema)).toEqual(['tokenId', 'expectedOrderHash', 'maxAmount']);
        });

        it('tells the agent it will never substitute another listing', () => {
            const harness = buyCellHarness();

            expect(harness.tool.description).toContain('staleListing');
            expect(harness.tool.description).toContain('unfulfillable');
            expect(harness.tool.description).toContain('never substitutes');
        });

        it('summarizes the purchase beside the machine-readable result', async () => {
            const harness = buyCellHarness();

            const result = await harness.handler(buyCellArgs());

            expect(summary(result)).toContain(`Cell ${TOKEN_ID} is bought`);
            expect(summary(result)).toContain(ORDER_HASH);
            expect(summary(result)).toContain(SELLER);
            expect(parsed(result).wallet).toBe(BUYER);
        });

        it('reports the native currency of the order it bought', async () => {
            const harness = buyCellHarness();

            const result = parsed(await harness.handler(buyCellArgs()));

            expect(result.currency).toEqual({ address: zeroAddress, symbol: 'ETH', decimals: 18 });
            expect(result.maxAmount).toBe(MAX_AMOUNT);
            expect(result.stage).toBe(MarketActionStage.Verify);
        });
    });
});
