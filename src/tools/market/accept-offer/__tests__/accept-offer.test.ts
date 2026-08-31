import { decodeFunctionData } from 'viem';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    acceptOfferArgs,
    acceptOfferHarness,
    AMOUNT,
    approvalData,
    approvalWire,
    BARE_APPROVAL_SELECTOR,
    BUYER,
    COLLECTION,
    collectionOfferWire,
    CONDUIT,
    CURRENCY,
    FakeAppConfig,
    FakeSellerWallet,
    FakeTransactionReader,
    fulfilmentWire,
    NOW_SECONDS,
    offerWire,
    orderFulfilledLog,
    OTHER_CONTRACT,
    OTHER_ORDER_HASH,
    OTHER_TOKEN_ID,
    ORDER_HASH,
    parsed,
    PREPARE_PATH,
    preparedWire,
    reply,
    SELLER,
    STRANGER,
    summary,
    TOKEN_ID,
    traitOfferWire,
    transportOf,
    txHash,
} from './fixtures.js';
import { ERC721_OPERATOR_ABI } from '../../../../contracts/erc721.abi.js';
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

describe('accepting one exact Cell offer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('the offer kinds it accepts', () => {
        it('sells the Cell an item offer names, without being told which Cell', async () => {
            const harness = acceptOfferHarness();

            const result = parsed(await harness.handler(acceptOfferArgs()));

            expect(result.status).toBe(MarketActionStatus.Completed);
            expect(result.tokenId).toBe(TOKEN_ID);
            expect(result.orderHash).toBe(ORDER_HASH);
            expect(result.buyer).toBe(BUYER);
            expect(result.amount).toBe(AMOUNT);
            expect(result.currency).toEqual(CURRENCY);
            expect(harness.transport.calls[0]?.body).toEqual({ orderHash: ORDER_HASH });
        });

        it('sells the explicitly selected Cell against a trait offer', async () => {
            const harness = acceptOfferHarness(transportOf(reply(200, preparedWire({ offer: traitOfferWire() }))));

            const result = parsed(await harness.handler(acceptOfferArgs({ tokenId: TOKEN_ID })));

            expect(result.status).toBe(MarketActionStatus.Completed);
            expect(result.tokenId).toBe(TOKEN_ID);
            expect(harness.transport.calls[0]?.body).toEqual({ orderHash: ORDER_HASH, tokenId: TOKEN_ID });
        });

        it('sells the explicitly selected Cell against a collection offer', async () => {
            const harness = acceptOfferHarness(transportOf(reply(200, preparedWire({ offer: collectionOfferWire() }))));

            const result = parsed(await harness.handler(acceptOfferArgs({ tokenId: TOKEN_ID })));

            expect(result.status).toBe(MarketActionStatus.Completed);
            expect(result.tokenId).toBe(TOKEN_ID);
        });

        it('refuses a trait offer with no Cell selected, before sending anything', async () => {
            const harness = acceptOfferHarness(
                transportOf(reply(400, errorWire(MarketErrorCode.InvalidRequest, 'tokenId is required'))),
            );

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidRequest);
            expect(error.stage).toBe(MarketActionStage.Prepare);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a collection offer with no Cell selected, before sending anything', async () => {
            const harness = acceptOfferHarness(
                transportOf(reply(400, errorWire(MarketErrorCode.InvalidRequest, 'tokenId is required'))),
            );

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidRequest);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses an item offer for a Cell other than the one named', async () => {
            const harness = acceptOfferHarness();

            const error = await failure(harness.handler(acceptOfferArgs({ tokenId: OTHER_TOKEN_ID })));

            expect(error.code).toBe(MarketErrorCode.InvalidInput);
            expect(error.message).toContain(TOKEN_ID);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a preparation that bound a Cell other than the selected one', async () => {
            const wire = preparedWire({ offer: collectionOfferWire(), tokenId: OTHER_TOKEN_ID });
            const harness = acceptOfferHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(acceptOfferArgs({ tokenId: TOKEN_ID })));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.message).toContain(OTHER_TOKEN_ID);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses an item offer whose order names no Cell at all', async () => {
            const harness = acceptOfferHarness(
                transportOf(reply(200, preparedWire({ offer: offerWire({ tokenId: null }) }))),
            );

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });
    });

    describe('the transactions it sends', () => {
        it('approves the collection, waits for that receipt, and only then fulfils', async () => {
            const harness = acceptOfferHarness();

            const result = parsed(await harness.handler(acceptOfferArgs()));

            expect(harness.wallet.log).toEqual([
                'read:ownerOf',
                'read:information',
                'read:getKey',
                `send:${COLLECTION}:0`,
                `receipt:${txHash(1)}`,
                `send:${SEAPORT_ADDRESS}:0`,
                `receipt:${txHash(2)}`,
                'read:ownerOf',
            ]);
            expect(result.approvalTxHashes).toEqual([txHash(1)]);
            expect(result.fulfilmentTxHash).toBe(txHash(2));
            expect(result.txHashes).toEqual([txHash(1), txHash(2)]);
        });

        it('fulfils directly when the wallet already approved the collection', async () => {
            const harness = acceptOfferHarness(
                transportOf(reply(200, preparedWire({ transactions: [fulfilmentWire()] }))),
            );

            const result = parsed(await harness.handler(acceptOfferArgs()));

            expect(result.approvalTxHashes).toEqual([]);
            expect(result.fulfilmentTxHash).toBe(txHash(1));
            expect(harness.wallet.sendCount).toBe(1);
        });

        it('broadcasts the approval bytes it validated', async () => {
            const harness = acceptOfferHarness();

            await harness.handler(acceptOfferArgs());

            expect(
                decodeFunctionData({ abi: ERC721_OPERATOR_ABI, data: harness.wallet.sent[0]?.data ?? '0x' }),
            ).toEqual({ functionName: 'setApprovalForAll', args: [CONDUIT, true] });
        });

        it('asks the game API to prepare exactly the pinned order, once per attempt', async () => {
            const harness = acceptOfferHarness();

            await harness.handler(acceptOfferArgs());

            expect(harness.transport.calls).toHaveLength(1);
            expect(harness.transport.calls[0]?.path).toBe(PREPARE_PATH);
            expect(harness.transport.calls[0]?.method).toBe('POST');
        });
    });

    describe('never substituting another order or another Cell', () => {
        it('refuses a preparation for a different order hash', async () => {
            const wire = preparedWire({ offer: offerWire({ orderHash: OTHER_ORDER_HASH, amount: '9' + AMOUNT }) });
            const harness = acceptOfferHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.OrderUnavailable);
            expect(error.message).toContain(OTHER_ORDER_HASH);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses an offer that already expired', async () => {
            const wire = preparedWire({ offer: offerWire({ expirationTime: NOW_SECONDS - 1 }) });
            const harness = acceptOfferHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.OrderUnavailable);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses an offer that is not acceptable yet', async () => {
            const wire = preparedWire({ offer: offerWire({ startTime: NOW_SECONDS + 3_600 }) });
            const harness = acceptOfferHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.OrderUnavailable);
        });

        it('reports an unavailable offer from the game API without looking for a replacement', async () => {
            const harness = acceptOfferHarness(
                transportOf(reply(404, errorWire(MarketErrorCode.StaleOffer, 'that offer is gone'))),
            );

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.StaleOffer);
            expect(error.retryable).toBe(false);
            expect(harness.transport.calls).toHaveLength(1);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses to accept an offer this wallet made itself', async () => {
            const harness = acceptOfferHarness(
                transportOf(reply(200, preparedWire({ offer: offerWire({ maker: SELLER }) }))),
            );

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.WrongOwner);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses to sell a Cell this wallet does not own', async () => {
            const harness = acceptOfferHarness(transportOf(), { wallet: new FakeSellerWallet({ owner: STRANGER }) });

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.WrongOwner);
            expect(error.stage).toBe(MarketActionStage.Prepare);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('stays retryable and sends nothing when the collection cannot be read before the sale', async () => {
            const harness = acceptOfferHarness(transportOf(), {
                wallet: new FakeSellerWallet({ cellReadFailsAt: 1 }),
            });

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.NetworkFailure);
            expect(error.retryable).toBe(true);
            expect(harness.wallet.sendCount).toBe(0);
        });
    });

    describe('validating the prepared work before approving anything', () => {
        it('injects the wallet chain because the canonical preparation wire carries no chain on the offer', async () => {
            const harness = acceptOfferHarness();

            const result = parsed(await harness.handler(acceptOfferArgs()));

            expect((result.offer as { chainId: number }).chainId).toBe(harness.wallet.getChainId());
            expect(offerWire()).not.toHaveProperty('chainId');
        });

        it('refuses a transaction that would be sent on another chain', async () => {
            const wire = preparedWire({ transactions: [approvalWire(), fulfilmentWire({ chainId: 8453 })] });
            const harness = acceptOfferHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.ChainMismatch);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a preparation naming another protocol deployment', async () => {
            const harness = acceptOfferHarness(
                transportOf(reply(200, preparedWire({ protocolAddress: OTHER_CONTRACT }))),
            );

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.ProtocolAddressMismatch);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a transaction kind an acceptance never needs', async () => {
            const wire = preparedWire({
                transactions: [approvalWire({ kind: MarketTransactionKind.CurrencyApproval }), fulfilmentWire()],
            });
            const harness = acceptOfferHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.message).toContain(MarketTransactionKind.CurrencyApproval);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a sequence that does not end with the fulfilment', async () => {
            const wire = preparedWire({ transactions: [fulfilmentWire(), approvalWire()] });
            const harness = acceptOfferHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses two fulfilment transactions for one offer', async () => {
            const wire = preparedWire({ transactions: [fulfilmentWire(), fulfilmentWire()] });
            const harness = acceptOfferHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a fulfilment that carries no calldata', async () => {
            const wire = preparedWire({ transactions: [approvalWire(), fulfilmentWire({ data: '0x' })] });
            const harness = acceptOfferHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a preparation with no transactions at all', async () => {
            const harness = acceptOfferHarness(transportOf(reply(200, preparedWire({ transactions: [] }))));

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses to spend the wallet native balance on a sale it is paid for', async () => {
            const wire = preparedWire({ transactions: [approvalWire(), fulfilmentWire({ value: '5' })] });
            const harness = acceptOfferHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses an approval pointed at anything but the Cell collection', async () => {
            const wire = preparedWire({ transactions: [approvalWire({ to: OTHER_CONTRACT }), fulfilmentWire()] });
            const harness = acceptOfferHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.message).toContain(OTHER_CONTRACT);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it.each([
            ['carries an approval selector with no arguments behind it', { data: BARE_APPROVAL_SELECTOR }],
            ['is not an approval at all', { data: '0xdeadbeef' }],
            ['withdraws an approval instead of granting one', { data: approvalData(CONDUIT, false) }],
            ['hands every Cell to an operator the protocol does not know', { data: approvalData(STRANGER) }],
        ])('refuses a prepared collection approval that %s', async (_label, over) => {
            const wire = preparedWire({ transactions: [approvalWire(over), fulfilmentWire()] });
            const harness = acceptOfferHarness(transportOf(reply(200, wire)));

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses an approval whose operator the protocol registry disowns', async () => {
            const harness = acceptOfferHarness(transportOf(), {
                wallet: new FakeSellerWallet({ conduitKnown: false }),
            });

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.message).toContain(CONDUIT);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('approves nothing and stays retryable when the protocol cannot be read', async () => {
            const harness = acceptOfferHarness(transportOf(), {
                wallet: new FakeSellerWallet({ protocolReadFails: true }),
            });

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.NetworkFailure);
            expect(error.retryable).toBe(true);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses a prepared response whose offer is already expired', async () => {
            const harness = acceptOfferHarness(transportOf(reply(200, preparedWire({ expiresAt: NOW_SECONDS - 1 }))));

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.OrderUnavailable);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('refuses to trust an unconfigured Cell collection', async () => {
            const harness = acceptOfferHarness(transportOf(), { appConfig: new FakeAppConfig('') });

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(harness.wallet.sendCount).toBe(0);
        });
    });

    describe('proving the sale from the receipt', () => {
        it('refuses a fulfilment event emitted by another contract', async () => {
            const wallet = new FakeSellerWallet({ logs: [orderFulfilledLog({ emitter: OTHER_CONTRACT })] });
            const harness = acceptOfferHarness(transportOf(), { wallet });

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.message).toContain(SEAPORT_ADDRESS);
            expect(error.txHash).toBe(txHash(2));
        });

        it('refuses a fulfilment event for another order hash', async () => {
            const wallet = new FakeSellerWallet({ logs: [orderFulfilledLog({ orderHash: OTHER_ORDER_HASH })] });
            const harness = acceptOfferHarness(transportOf(), { wallet });

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.message).toContain(ORDER_HASH);
        });

        it('refuses a fulfilment that paid another address for the Cell', async () => {
            const wallet = new FakeSellerWallet({ logs: [orderFulfilledLog({ recipient: STRANGER })] });
            const harness = acceptOfferHarness(transportOf(), { wallet });

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.WrongOwner);
        });

        it('refuses a fulfilment transaction another wallet sent', async () => {
            const harness = acceptOfferHarness(transportOf(), { reader: new FakeTransactionReader(STRANGER) });

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.WrongOwner);
            expect(error.message).toContain(STRANGER);
        });

        it('reads the sender of the fulfilment transaction it broadcast', async () => {
            const harness = acceptOfferHarness();

            await harness.handler(acceptOfferArgs());

            expect(harness.reader.asked).toEqual([txHash(2)]);
        });

        it('refuses to report a sale while the Cell is still owned by this wallet', async () => {
            const harness = acceptOfferHarness(transportOf(), { wallet: new FakeSellerWallet({ transfers: [] }) });

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.WrongOwner);
            expect(error.message).toContain(TOKEN_ID);
            expect(error.txHash).toBe(txHash(2));
        });

        it('checks ownership of the bound Cell on the configured collection', async () => {
            const harness = acceptOfferHarness();

            await harness.handler(acceptOfferArgs());

            const cellReads = harness.wallet.reads.filter((read) => read.functionName === 'ownerOf');
            expect(cellReads).toHaveLength(2);
            expect(cellReads[1]?.address.toLowerCase()).toBe(COLLECTION.toLowerCase());
            expect(cellReads[1]?.args).toEqual([BigInt(TOKEN_ID)]);
        });

        it('keeps the outcome open when ownership cannot be read back', async () => {
            const harness = acceptOfferHarness(transportOf(), {
                wallet: new FakeSellerWallet({ cellReadFailsAt: 2 }),
            });

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
            expect(error.retryable).toBe(true);
            expect(error.txHash).toBe(txHash(2));
            expect(harness.recovery.size()).toBe(1);
        });
    });

    describe('a criteria offer that stays active', () => {
        it('does not read the order state back, so a still-active order is not a failure', async () => {
            const harness = acceptOfferHarness(transportOf(reply(200, preparedWire({ offer: collectionOfferWire() }))));

            const result = parsed(await harness.handler(acceptOfferArgs({ tokenId: TOKEN_ID })));

            expect(result.status).toBe(MarketActionStatus.Completed);
            expect(harness.transport.calls.map((call) => call.path)).toEqual([PREPARE_PATH]);
        });

        it('sells a second Cell against the same still-active collection offer', async () => {
            const wallet = new FakeSellerWallet({ transfers: [TOKEN_ID, OTHER_TOKEN_ID] });
            const transport = transportOf(
                reply(200, preparedWire({ offer: collectionOfferWire(), tokenId: TOKEN_ID })),
                reply(200, preparedWire({ offer: collectionOfferWire(), tokenId: OTHER_TOKEN_ID })),
            );
            const harness = acceptOfferHarness(transport, { wallet });

            const first = parsed(await harness.handler(acceptOfferArgs({ tokenId: TOKEN_ID })));
            const second = parsed(await harness.handler(acceptOfferArgs({ tokenId: OTHER_TOKEN_ID })));

            expect(first.tokenId).toBe(TOKEN_ID);
            expect(second.tokenId).toBe(OTHER_TOKEN_ID);
            expect(first.status).toBe(MarketActionStatus.Completed);
            expect(second.status).toBe(MarketActionStatus.Completed);
        });

        it('cannot sell the same Cell twice against a still-active offer', async () => {
            const harness = acceptOfferHarness(transportOf(reply(200, preparedWire({ offer: collectionOfferWire() }))));

            await harness.handler(acceptOfferArgs({ tokenId: TOKEN_ID }));
            const sentAfterSale = harness.wallet.sendCount;
            const error = await failure(harness.handler(acceptOfferArgs({ tokenId: TOKEN_ID })));

            expect(error.code).toBe(MarketErrorCode.WrongOwner);
            expect(error.stage).toBe(MarketActionStage.Prepare);
            expect(harness.wallet.sendCount).toBe(sentAfterSale);
        });
    });

    describe('when a transaction fails', () => {
        it('stops at a reverted collection approval and never fulfils', async () => {
            const wallet = new FakeSellerWallet({ revertsAt: 1 });
            const harness = acceptOfferHarness(transportOf(), { wallet });

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.TransactionReverted);
            expect(error.stage).toBe(MarketActionStage.Approve);
            expect(error.txHash).toBe(txHash(1));
            expect(wallet.sendCount).toBe(1);
            expect(harness.recovery.size()).toBe(0);
        });

        it('reports a reverted fulfilment as terminal and keeps no unresolved acceptance', async () => {
            const harness = acceptOfferHarness(transportOf(), { wallet: new FakeSellerWallet({ revertsAt: 2 }) });

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.TransactionReverted);
            expect(error.stage).toBe(MarketActionStage.Fulfil);
            expect(error.txHash).toBe(txHash(2));
            expect(error.message).toContain(txHash(1));
            expect(harness.recovery.size()).toBe(0);
        });

        it('sends no second fulfilment when the broadcast answer is lost', async () => {
            const wallet = new FakeSellerWallet({ sendFailsAt: 2 });
            const harness = acceptOfferHarness(transportOf(), { wallet });

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.NetworkFailure);
            expect(error.retryable).toBe(true);
            expect(error.stage).toBe(MarketActionStage.Fulfil);
            expect(wallet.sendCount).toBe(2);
            expect(wallet.log.at(-1)).toBe('send:lost');
        });

        it('keeps the outcome open when the fulfilment receipt cannot be read', async () => {
            const harness = acceptOfferHarness(transportOf(), { wallet: new FakeSellerWallet({ receiptFailsAt: 2 }) });

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
            expect(error.retryable).toBe(true);
            expect(error.txHash).toBe(txHash(2));
            expect(harness.recovery.size()).toBe(1);
        });
    });

    describe('repeating the same intent', () => {
        it('proves the transaction it already sent instead of selling a second time', async () => {
            const wallet = new FakeSellerWallet({ receiptFailsAt: 2 });
            const harness = acceptOfferHarness(transportOf(), { wallet });

            await failure(harness.handler(acceptOfferArgs()));
            const result = parsed(await harness.handler(acceptOfferArgs()));

            expect(result.status).toBe(MarketActionStatus.AlreadyCompleted);
            expect(result.fulfilmentTxHash).toBe(txHash(2));
            expect(result.tokenId).toBe(TOKEN_ID);
            expect(wallet.sendCount).toBe(2);
            expect(harness.transport.calls).toHaveLength(1);
        });

        it('forgets the acceptance once it is proven, so the next call is a fresh intent', async () => {
            const harness = acceptOfferHarness();

            await harness.handler(acceptOfferArgs());

            expect(harness.recovery.size()).toBe(0);
        });

        it('shares one operation between identical concurrent calls', async () => {
            const harness = acceptOfferHarness();

            const [first, second] = await Promise.all([
                harness.handler(acceptOfferArgs()),
                harness.handler(acceptOfferArgs()),
            ]);

            expect(parsed(first)).toEqual(parsed(second));
            expect(harness.transport.calls).toHaveLength(1);
            expect(harness.wallet.sendCount).toBe(2);
        });

        it('does not share an operation between different Cells of one offer', async () => {
            const wallet = new FakeSellerWallet({ transfers: [TOKEN_ID, OTHER_TOKEN_ID] });
            const transport = transportOf(
                reply(200, preparedWire({ offer: collectionOfferWire(), tokenId: TOKEN_ID })),
                reply(200, preparedWire({ offer: collectionOfferWire(), tokenId: OTHER_TOKEN_ID })),
            );
            const harness = acceptOfferHarness(transport, { wallet, singleFlight: new MarketSingleFlight() });

            await Promise.allSettled([
                harness.handler(acceptOfferArgs({ tokenId: TOKEN_ID })),
                harness.handler(acceptOfferArgs({ tokenId: OTHER_TOKEN_ID })),
            ]);

            expect(transport.calls).toHaveLength(2);
            expect(transport.calls.map((call) => (call.body as { tokenId: string }).tokenId)).toEqual([
                TOKEN_ID,
                OTHER_TOKEN_ID,
            ]);
        });

        it('keeps unresolved acceptances inside the process-local store', async () => {
            const recovery = new MarketRecoveryStore();
            const harness = acceptOfferHarness(transportOf(), {
                recovery,
                wallet: new FakeSellerWallet({ receiptFailsAt: 2 }),
            });

            await failure(harness.handler(acceptOfferArgs()));

            expect(recovery.size()).toBe(1);
        });
    });

    describe('the errors it reports', () => {
        it('rejects an order hash that is not a 32-byte value', async () => {
            const harness = acceptOfferHarness();

            const error = await failure(harness.handler(acceptOfferArgs({ orderHash: '0xdeadbeef' })));

            expect(error.code).toBe(MarketErrorCode.InvalidInput);
            expect(harness.transport.calls).toHaveLength(0);
        });

        it('rejects a token id that is not canonical', async () => {
            const harness = acceptOfferHarness();

            const error = await failure(harness.handler(acceptOfferArgs({ tokenId: '01234' })));

            expect(error.code).toBe(MarketErrorCode.InvalidInput);
            expect(harness.transport.calls).toHaveLength(0);
        });

        it('keeps a rate limit carrying a terminal code terminal on this money path', async () => {
            const harness = acceptOfferHarness(
                transportOf(
                    reply(429, errorWire(MarketErrorCode.StaleOffer, 'that offer is gone'), { 'retry-after': '30' }),
                ),
            );

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.StaleOffer);
            expect(error.retryable).toBe(false);
            expect(error.retryAfterSeconds).toBe(30);
            expect(harness.transport.calls).toHaveLength(1);
        });

        it('refuses a created-without-body answer rather than guessing what was prepared', async () => {
            const harness = acceptOfferHarness(transportOf(reply(201, null)));

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
            expect(error.retryable).toBe(false);
            expect(harness.wallet.sendCount).toBe(0);
            expect(harness.recovery.size()).toBe(0);
        });

        it('reports a refused session without sending anything', async () => {
            const harness = acceptOfferHarness(transportOf(reply(401, errorWire('UNAUTHORIZED', 'nope'))));

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.code).toBe(MarketErrorCode.Unauthorized);
            expect(harness.wallet.sendCount).toBe(0);
        });

        it('names the stage every failure reached', async () => {
            const harness = acceptOfferHarness(
                transportOf(reply(200, preparedWire({ protocolAddress: OTHER_CONTRACT }))),
            );

            const error = await failure(harness.handler(acceptOfferArgs()));

            expect(error.stage).toBe(MarketActionStage.Prepare);
            expect(error.message).toContain('stage "prepare"');
        });
    });

    describe('the tool surface', () => {
        it('is registered under its public name with the two inputs it accepts', () => {
            const harness = acceptOfferHarness();

            expect(harness.name).toBe('cpu_accept_cell_offer');
            expect(Object.keys(harness.inputSchema)).toEqual(['orderHash', 'tokenId']);
        });

        it('tells the agent a criteria offer needs an explicit Cell and no order is substituted', () => {
            const harness = acceptOfferHarness();

            expect(harness.description).toContain('staleOffer');
            expect(harness.description).toContain('unfulfillable');
            expect(harness.description).toContain('never substitutes');
        });

        it('summarizes the sale beside the machine-readable result', async () => {
            const harness = acceptOfferHarness();

            const result = await harness.handler(acceptOfferArgs());

            expect(summary(result)).toContain(`Cell ${TOKEN_ID} is sold`);
            expect(summary(result)).toContain(ORDER_HASH);
            expect(summary(result)).toContain(BUYER);
            expect(parsed(result).wallet).toBe(SELLER);
            expect(parsed(result).stage).toBe(MarketActionStage.Verify);
        });

        it('reports the accepted offer beside the Cell it bound', async () => {
            const harness = acceptOfferHarness(transportOf(reply(200, preparedWire({ offer: collectionOfferWire() }))));

            const result = parsed(await harness.handler(acceptOfferArgs({ tokenId: TOKEN_ID })));

            const acceptedOffer = result.offer as { tokenId: string; kind: string };
            expect(acceptedOffer.tokenId).toBe(TOKEN_ID);
            expect(acceptedOffer.kind).toBe(collectionOfferWire().kind);
            expect(result.tokenId).toBe(TOKEN_ID);
        });
    });
});
