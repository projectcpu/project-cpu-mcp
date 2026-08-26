import { encodeAbiParameters, encodeEventTopics, type Hash, type Log } from 'viem';
import { describe, expect, it } from 'vitest';

import { SEAPORT_EVENTS_ABI } from '../../../contracts/seaport-events.abi.js';
import { SEAPORT_ADDRESS } from '../../../contracts/seaport.constants.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { TxStatus, type TxReceipt } from '../../../wallet/types.js';
import { MarketError } from '../error.js';
import { MarketFulfilmentProof } from '../fulfilment-proof.js';
import type { IFulfilmentTransactionReader } from '../fulfilment-proof.types.js';
import { MarketActionStage, MarketErrorCode } from '../types.js';

const WALLET = `0x${'1'.repeat(40)}`;

const SELLER = `0x${'2'.repeat(40)}`;

const STRANGER = `0x${'3'.repeat(40)}`;

const ANOTHER_CONTRACT = `0x${'4'.repeat(40)}`;

const ZONE = `0x${'0'.repeat(40)}`;

const ORDER_HASH = `0x${'a'.repeat(64)}`;

const OTHER_ORDER_HASH = `0x${'b'.repeat(64)}`;

const TX_HASH = `0x${'c'.repeat(64)}` as Hash;

const FULFILLED_DATA_PARAMS = [
    { name: 'orderHash', type: 'bytes32' },
    { name: 'recipient', type: 'address' },
    {
        name: 'offer',
        type: 'tuple[]',
        components: [
            { name: 'itemType', type: 'uint8' },
            { name: 'token', type: 'address' },
            { name: 'identifier', type: 'uint256' },
            { name: 'amount', type: 'uint256' },
        ],
    },
    {
        name: 'consideration',
        type: 'tuple[]',
        components: [
            { name: 'itemType', type: 'uint8' },
            { name: 'token', type: 'address' },
            { name: 'identifier', type: 'uint256' },
            { name: 'amount', type: 'uint256' },
            { name: 'recipient', type: 'address' },
        ],
    },
] as const;

interface FulfilledOver {
    emitter: string;
    orderHash: string;
    recipient: string;
    offerer: string;
}

function fulfilledLog(over: Partial<FulfilledOver> = {}): Log {
    const shape: FulfilledOver = {
        emitter: SEAPORT_ADDRESS,
        orderHash: ORDER_HASH,
        recipient: WALLET,
        offerer: SELLER,
        ...over,
    };

    return {
        address: shape.emitter,
        topics: encodeEventTopics({
            abi: SEAPORT_EVENTS_ABI,
            eventName: 'OrderFulfilled',
            args: { offerer: shape.offerer as `0x${string}`, zone: ZONE as `0x${string}` },
        }),
        data: encodeAbiParameters(FULFILLED_DATA_PARAMS, [
            shape.orderHash as `0x${string}`,
            shape.recipient as `0x${string}`,
            [],
            [],
        ]),
    } as unknown as Log;
}

function cancelledLog(over: Partial<{ emitter: string; orderHash: string; offerer: string }> = {}): Log {
    const shape = { emitter: SEAPORT_ADDRESS, orderHash: ORDER_HASH, offerer: WALLET, ...over };

    return {
        address: shape.emitter,
        topics: encodeEventTopics({
            abi: SEAPORT_EVENTS_ABI,
            eventName: 'OrderCancelled',
            args: { offerer: shape.offerer as `0x${string}`, zone: ZONE as `0x${string}` },
        }),
        data: encodeAbiParameters([{ name: 'orderHash', type: 'bytes32' }], [shape.orderHash as `0x${string}`]),
    } as unknown as Log;
}

function receipt(logs: Array<Log>): TxReceipt {
    return { status: TxStatus.Success, transactionHash: TX_HASH, blockNumber: 7n, logs };
}

class FakeTransactionReader implements IFulfilmentTransactionReader {
    readonly asked: Array<string> = [];

    constructor(private readonly sender: string | null) {}

    async senderOf(txHash: string): Promise<string | null> {
        this.asked.push(txHash);
        return this.sender;
    }
}

function proofWith(sender: string | null = WALLET): MarketFulfilmentProof {
    return new MarketFulfilmentProof({ transactions: new FakeTransactionReader(sender), logger: new NoopLogger() });
}

async function rejection(promise: Promise<unknown>): Promise<MarketError> {
    const outcome = await promise.then(
        () => null,
        (error: unknown) => error,
    );
    expect(outcome).toBeInstanceOf(MarketError);
    return outcome as MarketError;
}

function fulfilmentRequest(logs: Array<Log>) {
    return {
        receipt: receipt(logs),
        orderHash: ORDER_HASH,
        wallet: WALLET,
        stage: MarketActionStage.Verify,
    };
}

describe('proving that this wallet fulfilled one exact order', () => {
    it('accepts a pinned-Seaport log carrying the exact order hash, sender and recipient', async () => {
        const proof = await proofWith().requireFulfilment(fulfilmentRequest([fulfilledLog()]));

        expect(proof).toEqual({ orderHash: ORDER_HASH, offerer: SELLER, recipient: WALLET, sender: WALLET });
    });

    it('finds the order among unrelated logs of the same transaction', async () => {
        const noise = fulfilledLog({ emitter: ANOTHER_CONTRACT, orderHash: OTHER_ORDER_HASH });

        const proof = await proofWith().requireFulfilment(fulfilmentRequest([noise, fulfilledLog()]));

        expect(proof.orderHash).toBe(ORDER_HASH);
    });

    it('refuses a log the pinned Seaport did not emit', async () => {
        const error = await rejection(
            proofWith().requireFulfilment(fulfilmentRequest([fulfilledLog({ emitter: ANOTHER_CONTRACT })])),
        );

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(error.retryable).toBe(false);
        expect(error.txHash).toBe(TX_HASH);
    });

    it('refuses a log that fulfils another order', async () => {
        const error = await rejection(
            proofWith().requireFulfilment(fulfilmentRequest([fulfilledLog({ orderHash: OTHER_ORDER_HASH })])),
        );

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect(error.message).toContain(ORDER_HASH);
    });

    it('refuses a transaction another wallet sent', async () => {
        const error = await rejection(proofWith(STRANGER).requireFulfilment(fulfilmentRequest([fulfilledLog()])));

        expect(error.code).toBe(MarketErrorCode.WrongOwner);
        expect(error.message).toContain(STRANGER);
    });

    it('refuses a fulfilment whose offered items went to another address', async () => {
        const error = await rejection(
            proofWith().requireFulfilment(fulfilmentRequest([fulfilledLog({ recipient: STRANGER })])),
        );

        expect(error.code).toBe(MarketErrorCode.WrongOwner);
    });

    it('settles nothing when the sending wallet cannot be read back', async () => {
        const error = await rejection(proofWith(null).requireFulfilment(fulfilmentRequest([fulfilledLog()])));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(error.retryable).toBe(true);
        expect(error.txHash).toBe(TX_HASH);
    });

    it('refuses a receipt with no order event at all', async () => {
        const error = await rejection(proofWith().requireFulfilment(fulfilmentRequest([])));

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
    });

    it('reads the sender of the receipt transaction and no other', async () => {
        const reader = new FakeTransactionReader(WALLET);
        const proof = new MarketFulfilmentProof({ transactions: reader, logger: new NoopLogger() });

        await proof.requireFulfilment(fulfilmentRequest([fulfilledLog()]));

        expect(reader.asked).toEqual([TX_HASH]);
    });
});

describe('proving that this wallet cancelled one exact order', () => {
    function cancellationRequest(logs: Array<Log>) {
        return { receipt: receipt(logs), orderHash: ORDER_HASH, wallet: WALLET, stage: MarketActionStage.Cancel };
    }

    it('accepts a pinned-Seaport cancellation of the exact order by this maker', async () => {
        const proof = await proofWith().requireCancellation(cancellationRequest([cancelledLog()]));

        expect(proof).toEqual({ orderHash: ORDER_HASH, offerer: WALLET, sender: WALLET });
    });

    it('refuses a cancellation the pinned Seaport did not emit', async () => {
        const error = await rejection(
            proofWith().requireCancellation(cancellationRequest([cancelledLog({ emitter: ANOTHER_CONTRACT })])),
        );

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
    });

    it('refuses a cancellation of another order', async () => {
        const error = await rejection(
            proofWith().requireCancellation(cancellationRequest([cancelledLog({ orderHash: OTHER_ORDER_HASH })])),
        );

        expect(error.code).toBe(MarketErrorCode.InvalidMarketResponse);
    });

    it('refuses a cancellation of another wallet order', async () => {
        const error = await rejection(
            proofWith().requireCancellation(cancellationRequest([cancelledLog({ offerer: STRANGER })])),
        );

        expect(error.code).toBe(MarketErrorCode.WrongOwner);
    });

    it('refuses a cancellation another wallet sent', async () => {
        const error = await rejection(proofWith(STRANGER).requireCancellation(cancellationRequest([cancelledLog()])));

        expect(error.code).toBe(MarketErrorCode.WrongOwner);
    });
});
