import { describe, expect, it } from 'vitest';

import {
    backendSnapshotWire,
    backendOrderFrom,
    emptySnapshotWire,
    FakeMarketTransport,
    marketServiceOver,
    offerWire,
    reply,
    snapshotWire,
} from './fixtures.js';
import { MarketError } from '../error.js';
import { MarketErrorCode, MarketOfferKind } from '../types.js';

describe('MarketService.getCellMarket', () => {
    it('reads the authenticated Cell-market route for the requested Cell', async () => {
        const transport = new FakeMarketTransport([reply(200, backendSnapshotWire)]);

        const snapshot = await marketServiceOver(transport).getCellMarket('1234');

        expect(transport.calls).toEqual([{ path: '/api/v1/market/cells/1234', method: 'GET', body: null }]);
        expect(snapshot.tokenId).toBe('1234');
        expect(snapshot.bestListing?.orderHash).toBe(snapshotWire.bestListing.orderHash);
    });

    it('adapts the public snapshot wire shape into the tool model', async () => {
        const transport = new FakeMarketTransport([reply(200, backendSnapshotWire)]);

        const snapshot = await marketServiceOver(transport).getCellMarket('1234');

        expect(snapshot.bestListing).toMatchObject({
            chainId: 4663,
            price: snapshotWire.bestListing.price,
            currency: snapshotWire.bestListing.currency,
            startTime: snapshotWire.bestListing.startTime,
            expirationTime: snapshotWire.bestListing.expirationTime,
        });
        expect(snapshot.bestOffer).toMatchObject({
            chainId: 4663,
            amount: snapshotWire.bestOffer.amount,
            currency: snapshotWire.bestOffer.currency,
            startTime: snapshotWire.bestOffer.startTime,
            expirationTime: snapshotWire.bestOffer.expirationTime,
        });
    });

    it('returns both sides as null for a Cell nobody is trading', async () => {
        const transport = new FakeMarketTransport([reply(200, emptySnapshotWire)]);

        const snapshot = await marketServiceOver(transport).getCellMarket('1234');

        expect(snapshot.bestListing).toBeNull();
        expect(snapshot.bestOffer).toBeNull();
    });

    it('keeps the two sides independent when only one of them exists', async () => {
        const transport = new FakeMarketTransport([
            reply(200, {
                ...emptySnapshotWire,
                bestOffer: {
                    ...backendOrderFrom(offerWire(MarketOfferKind.Item, '1234')),
                    kind: MarketOfferKind.Item,
                },
            }),
        ]);

        const snapshot = await marketServiceOver(transport).getCellMarket('1234');

        expect(snapshot.bestListing).toBeNull();
        expect(snapshot.bestOffer?.kind).toBe(MarketOfferKind.Item);
    });

    it('preserves every offer kind, and lets a criteria offer carry no bound Cell', async () => {
        for (const kind of Object.values(MarketOfferKind)) {
            const tokenId = kind === MarketOfferKind.Item ? '1234' : null;
            const transport = new FakeMarketTransport([
                reply(200, {
                    ...backendSnapshotWire,
                    bestOffer: { ...backendOrderFrom(offerWire(kind, tokenId)), kind },
                }),
            ]);

            const snapshot = await marketServiceOver(transport).getCellMarket('1234');

            expect(snapshot.bestOffer?.kind).toBe(kind);
            expect(snapshot.bestOffer?.tokenId).toBe(tokenId);
        }
    });

    it('refuses a Cell id that is not canonical rather than asking for two identities of one Cell', async () => {
        const transport = new FakeMarketTransport([reply(200, backendSnapshotWire)]);

        const error = await marketServiceOver(transport)
            .getCellMarket('01234')
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(MarketError);
        expect((error as MarketError).code).toBe(MarketErrorCode.InvalidInput);
        expect(transport.calls).toHaveLength(0);
    });

    it('rejects a snapshot whose order hash is malformed instead of handing it to the agent', async () => {
        const transport = new FakeMarketTransport([
            reply(200, {
                ...backendSnapshotWire,
                bestListing: { ...backendSnapshotWire.bestListing, orderHash: '0xdead' },
            }),
        ]);

        const error = await marketServiceOver(transport)
            .getCellMarket('1234')
            .catch((e: unknown) => e);

        expect((error as MarketError).code).toBe(MarketErrorCode.InvalidMarketResponse);
    });

    it('refuses a snapshot that describes another Cell instead of the one that was asked for', async () => {
        const transport = new FakeMarketTransport([reply(200, { ...backendSnapshotWire, tokenId: '999' })]);

        const error = await marketServiceOver(transport)
            .getCellMarket('1234')
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(MarketError);
        expect((error as MarketError).code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect((error as MarketError).retryable).toBe(false);
        expect((error as MarketError).message).toMatch(/Cell 999/);
    });

    it('refuses a best listing that sells a different Cell', async () => {
        const transport = new FakeMarketTransport([
            reply(200, {
                ...backendSnapshotWire,
                bestListing: { ...backendSnapshotWire.bestListing, tokenId: '4242' },
            }),
        ]);

        const error = await marketServiceOver(transport)
            .getCellMarket('1234')
            .catch((e: unknown) => e);

        expect((error as MarketError).code).toBe(MarketErrorCode.InvalidMarketResponse);
        expect((error as MarketError).message).toMatch(/Cell 4242/);
    });

    it('refuses a best offer that bids on a different Cell', async () => {
        const transport = new FakeMarketTransport([
            reply(200, {
                ...backendSnapshotWire,
                bestOffer: {
                    ...backendOrderFrom(offerWire(MarketOfferKind.Collection, '4242')),
                    kind: MarketOfferKind.Collection,
                },
            }),
        ]);

        const error = await marketServiceOver(transport)
            .getCellMarket('1234')
            .catch((e: unknown) => e);

        expect((error as MarketError).code).toBe(MarketErrorCode.InvalidMarketResponse);
    });

    it('refuses an item offer that is bound to no Cell at all', async () => {
        const transport = new FakeMarketTransport([
            reply(200, {
                ...backendSnapshotWire,
                bestOffer: {
                    ...backendOrderFrom(offerWire(MarketOfferKind.Item, null)),
                    kind: MarketOfferKind.Item,
                },
            }),
        ]);

        const error = await marketServiceOver(transport)
            .getCellMarket('1234')
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(MarketError);
        expect((error as MarketError).code).toBe(MarketErrorCode.InvalidMarketResponse);
    });

    it('rejects a price that is not a base-unit integer string, so no amount reaches the agent as a number', async () => {
        const transport = new FakeMarketTransport([
            reply(200, {
                ...backendSnapshotWire,
                bestListing: {
                    ...backendSnapshotWire.bestListing,
                    price: { ...(backendSnapshotWire.bestListing.price as object), amountBaseUnits: 1.5 },
                },
            }),
        ]);

        const error = await marketServiceOver(transport)
            .getCellMarket('1234')
            .catch((e: unknown) => e);

        expect((error as MarketError).code).toBe(MarketErrorCode.InvalidMarketResponse);
    });
});
