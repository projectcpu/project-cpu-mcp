import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ToolEventType } from '../../types.js';
import { acceptOfferArgs, acceptOfferHarness, NOW_SECONDS } from '../accept-offer/__tests__/fixtures.js';
import { buyCellArgs, buyCellHarness } from '../buy-cell/__tests__/fixtures.js';
import { cancelOrderArgs, cancelOrderHarness } from '../cancel-order/__tests__/fixtures.js';
import {
    listCellArgs,
    listCellHarness,
    listingsPageWire,
    MarketRoute as ListingRoute,
    preparedWire as listingPreparedWire,
    reply as listingReply,
    RoutedMarketTransport as ListingTransport,
    settle as settleListing,
    submittedWire as listingSubmittedWire,
} from '../list-cell/__tests__/fixtures.js';
import {
    makeOfferArgs,
    makeOfferHarness,
    MarketRoute as OfferRoute,
    offersPageWire,
    preparedWire as offerPreparedWire,
    reply as offerReply,
    RoutedMarketTransport as OfferTransport,
    settle as settleOffer,
    submittedWire as offerSubmittedWire,
} from '../make-offer/__tests__/fixtures.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

function eventTypeOf(result: unknown): string | null {
    const content = (result as ToolResult).content;
    const parsed = JSON.parse(content[1]?.text ?? '{}') as Record<string, unknown>;
    const eventType = parsed.eventType;
    return typeof eventType === 'string' ? eventType : null;
}

function listingRoutes(): ListingTransport {
    return new ListingTransport({
        [ListingRoute.MyListings]: [listingReply(200, listingsPageWire([], null))],
        [ListingRoute.Prepare]: [listingReply(200, listingPreparedWire())],
        [ListingRoute.Submit]: [listingReply(200, listingSubmittedWire())],
    } as ConstructorParameters<typeof ListingTransport>[0]);
}

function offerRoutes(): OfferTransport {
    return new OfferTransport({
        [OfferRoute.MyOffers]: [offerReply(200, offersPageWire([], null))],
        [OfferRoute.Prepare]: [offerReply(200, offerPreparedWire())],
        [OfferRoute.Submit]: [offerReply(200, offerSubmittedWire())],
    } as ConstructorParameters<typeof OfferTransport>[0]);
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW_SECONDS * 1_000);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('every completed Cell marketplace action names its own event', () => {
    it('cpu_list_cell names CellListed', async () => {
        const harness = listCellHarness(listingRoutes());

        expect(eventTypeOf(await settleListing(harness.handler(listCellArgs())))).toBe(ToolEventType.CellListed);
    });

    it('cpu_make_cell_offer names CellOfferMade', async () => {
        const harness = makeOfferHarness(offerRoutes());

        expect(eventTypeOf(await settleOffer(harness.handler(makeOfferArgs())))).toBe(ToolEventType.CellOfferMade);
    });

    it('cpu_buy_cell names CellBought', async () => {
        const harness = buyCellHarness();

        expect(eventTypeOf(await harness.handler(buyCellArgs()))).toBe(ToolEventType.CellBought);
    });

    it('cpu_accept_cell_offer names CellOfferAccepted', async () => {
        const harness = acceptOfferHarness();

        expect(eventTypeOf(await harness.handler(acceptOfferArgs()))).toBe(ToolEventType.CellOfferAccepted);
    });

    it('cpu_cancel_order names MarketOrderCancelled', async () => {
        const harness = cancelOrderHarness();

        expect(eventTypeOf(await harness.handler(cancelOrderArgs()))).toBe(ToolEventType.MarketOrderCancelled);
    });
});
