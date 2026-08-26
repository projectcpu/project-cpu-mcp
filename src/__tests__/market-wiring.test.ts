import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { NoopLogger } from '../logger/noop.logger.js';
import { MarketActionTool } from '../services/market/action.types.js';
import { MarketError } from '../services/market/error.js';
import { createMarketCoordinator, createMarketServices } from '../services/market/factory.js';
import type { MarketServices } from '../services/market/factory.types.js';
import { MARKET_UNRESOLVED_ACTION_LIMIT } from '../services/market/recovery.constants.js';
import { MarketActionStage, MarketErrorCode } from '../services/market/types.js';
import type { IAppConfig } from '../services/types.js';
import {
    cancelOrderArgs,
    FakeMakerWallet,
    MAKER,
    NOW_SECONDS,
    ORDER_HASH,
    PRICE,
    STRANGER,
    TOKEN_ID,
    transportOf,
    txHash,
    type FakeMarketTransport,
} from '../tools/market/cancel-order/__tests__/fixtures.js';
import { createCancelOrderTool } from '../tools/market/cancel-order/cancel-order.js';

const NETWORK = 'robinhood';

interface Wired {
    services: MarketServices;
    wallet: FakeMakerWallet;
    transport: FakeMarketTransport;
}

function wire(wallet: FakeMakerWallet = new FakeMakerWallet(), transport = transportOf()): Wired {
    const services = createMarketServices({
        api: transport,
        appConfig: {} as unknown as IAppConfig,
        wallet,
        network: NETWORK,
        coordinator: null,
        logger: new NoopLogger(),
    });

    return { services, wallet, transport };
}

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

describe('the marketplace services the server is built with', () => {
    it('are all nine of the public surface', () => {
        const { services } = wire();

        expect(Object.keys(services).sort()).toEqual(
            [
                'market',
                'marketAcceptance',
                'marketCancel',
                'marketListing',
                'marketOffer',
                'marketProfile',
                'marketPurchase',
            ].sort(),
        );
    });

    it('prove a fulfilment by asking the wallet itself who sent the transaction', async () => {
        const { services, wallet } = wire();

        const result = await services.marketCancel.cancelOrder({ orderHash: ORDER_HASH });

        expect(result.cancellationTxHash).toBe(txHash(1));
        expect(wallet.senderAsks).toEqual([txHash(1)]);
    });

    it('refuse the proof when the wallet reports another sender, so the reader is not a stub', async () => {
        const { services, wallet } = wire(new FakeMakerWallet({ transactionSender: STRANGER }));

        const error = await failure(services.marketCancel.cancelOrder({ orderHash: ORDER_HASH }));

        expect(error.code).toBe(MarketErrorCode.WrongOwner);
        expect(error.retryable).toBe(false);
        expect(wallet.senderAsks).toEqual([txHash(1)]);
    });

    it('report an unreadable sender as an unknown outcome rather than a success', async () => {
        const { services } = wire(new FakeMakerWallet({ transactionSender: null }));

        const error = await failure(services.marketCancel.cancelOrder({ orderHash: ORDER_HASH }));

        expect(error.code).toBe(MarketErrorCode.OutcomeUnknown);
        expect(error.retryable).toBe(true);
        expect(error.txHash).toBe(txHash(1));
    });

    it('share one bounded unresolved-action store, so the 100 is a promise about the process', async () => {
        const coordinator = createMarketCoordinator();
        const transport = transportOf();
        const services = createMarketServices({
            api: transport,
            appConfig: {} as unknown as IAppConfig,
            wallet: new FakeMakerWallet(),
            network: NETWORK,
            coordinator,
            logger: new NoopLogger(),
        });

        for (let index = 0; index < MARKET_UNRESOLVED_ACTION_LIMIT; index += 1) {
            coordinator.recovery.write(`unresolved-${index}`, {
                tool: MarketActionTool.ListCell,
                stage: MarketActionStage.Prepare,
                payload: null,
            });
        }

        const cancelling = await failure(services.marketCancel.cancelOrder({ orderHash: ORDER_HASH }));
        const listing = await failure(
            services.marketListing.listCell({
                tokenId: TOKEN_ID,
                price: PRICE,
                expirationTime: NOW_SECONDS + 3_600,
                buyerAddress: null,
            }),
        );

        expect(cancelling.code).toBe(MarketErrorCode.UnresolvedCapacityFull);
        expect(listing.code).toBe(MarketErrorCode.UnresolvedCapacityFull);
        expect(cancelling.retryable).toBe(true);
        expect(coordinator.recovery.size()).toBe(MARKET_UNRESOLVED_ACTION_LIMIT);
        expect(transport.calls).toEqual([]);
    });

    it('do not evict an unresolved record to admit a new write', () => {
        const coordinator = createMarketCoordinator();
        for (let index = 0; index < MARKET_UNRESOLVED_ACTION_LIMIT; index += 1) {
            coordinator.recovery.write(`unresolved-${index}`, {
                tool: MarketActionTool.ListCell,
                stage: MarketActionStage.Prepare,
                payload: null,
            });
        }

        expect(() =>
            coordinator.recovery.write('one-too-many', {
                tool: MarketActionTool.ListCell,
                stage: MarketActionStage.Prepare,
                payload: null,
            }),
        ).toThrow(MarketError);
        expect(coordinator.recovery.read('unresolved-0')).not.toBeNull();
        expect(coordinator.recovery.read('one-too-many')).toBeNull();
    });
});

describe('the registered cancellation tool', () => {
    it('answers through the very services the server wires, for the wallet that signed in', async () => {
        const { services, wallet } = wire();
        const definition = createCancelOrderTool(services);
        const handler = definition.handler as (args: never) => Promise<{ content: Array<{ text: string }> }>;

        const result = await handler(cancelOrderArgs());
        const parsed = JSON.parse(result.content[1]?.text ?? '{}') as Record<string, unknown>;

        expect(parsed.wallet).toBe(MAKER);
        expect(parsed.orderHash).toBe(ORDER_HASH);
        expect(wallet.senderAsks).toEqual([txHash(1)]);
    });
});
