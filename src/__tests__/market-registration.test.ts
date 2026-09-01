import { describe, expect, it } from 'vitest';

import type { AcceptCellOfferRequest } from '../services/market/acceptance.types.js';
import type { CancelOrderRequest } from '../services/market/cancel.types.js';
import type { ListCellRequest } from '../services/market/listing.types.js';
import { MarketActionStatus, MarketOfferKind, MarketOrderKind } from '../services/market/types.js';
import {
    registerAcceptCellOfferTool,
    registerCancelOrderTool,
    registerGetMyListingsTool,
    registerListCellTool,
} from '../tools/market/register.js';
import type { ToolHandler, ToolRegistrar } from '../tools/types.js';
import type { AppContext } from '../types.js';

type Register = (server: ToolRegistrar, context: AppContext) => void;

const ORDER_HASH = `0x${'a'.repeat(64)}`;
const TOKEN_ID = '1234';

const CURRENCY = { address: `0x${'2'.repeat(40)}`, symbol: 'TEST', decimals: 18 };

const ACCEPTANCE_RESULT = {
    status: MarketActionStatus.Completed,
    tokenId: TOKEN_ID,
    orderHash: ORDER_HASH,
    wallet: `0x${'1'.repeat(40)}`,
    buyer: `0x${'3'.repeat(40)}`,
    amount: '1000',
    currency: CURRENCY,
    offer: { kind: MarketOfferKind.Item },
    approvalTxHashes: [],
    fulfilmentTxHash: `0x${'4'.repeat(64)}`,
    txHashes: [],
};

const CANCELLATION_RESULT = {
    status: MarketActionStatus.Completed,
    orderKind: MarketOrderKind.Listing,
    orderHash: ORDER_HASH,
    wallet: `0x${'1'.repeat(40)}`,
    tokenId: TOKEN_ID,
    cancellationTxHash: `0x${'5'.repeat(64)}`,
    txHashes: [],
};

const LISTING_RESULT = {
    status: MarketActionStatus.Completed,
    tokenId: TOKEN_ID,
    wallet: `0x${'1'.repeat(40)}`,
    listing: { orderHash: ORDER_HASH, expirationTime: 1_800_000_000 },
    grossPrice: '1000',
    currency: CURRENCY,
    platformFee: '10',
    creatorFee: '5',
    estimatedProceeds: '985',
    approvalTxHashes: [],
};

interface Seen {
    acceptance: Array<AcceptCellOfferRequest>;
    cancellation: Array<CancelOrderRequest>;
    listing: Array<ListCellRequest>;
    listingsCursor: Array<string | null>;
}

function contextWith(seen: Seen): AppContext {
    return {
        marketAcceptance: {
            acceptCellOffer: async (request: AcceptCellOfferRequest) => {
                seen.acceptance.push(request);
                return ACCEPTANCE_RESULT;
            },
        },
        marketCancel: {
            cancelOrder: async (request: CancelOrderRequest) => {
                seen.cancellation.push(request);
                return CANCELLATION_RESULT;
            },
        },
        marketListing: {
            listCell: async (request: ListCellRequest) => {
                seen.listing.push(request);
                return LISTING_RESULT;
            },
        },
        marketProfile: {
            getMyListings: async (cursor: string | null) => {
                seen.listingsCursor.push(cursor);
                return { items: [], nextCursor: null };
            },
        },
    } as unknown as AppContext;
}

function capture(register: Register, context: AppContext): ToolHandler {
    let captured: ToolHandler | null = null;
    const server = {
        registerTool(_name: string, _definition: unknown, handler: ToolHandler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    register(server, context);
    if (captured === null) {
        throw new Error('the tool registered no handler');
    }
    return captured;
}

function emptySeen(): Seen {
    return { acceptance: [], cancellation: [], listing: [], listingsCursor: [] };
}

describe('the arguments a registered marketplace tool actually receives', () => {
    it('turn an absent optional Cell into null, so an item offer needs no token', async () => {
        const seen = emptySeen();
        const handler = capture(registerAcceptCellOfferTool, contextWith(seen));

        await handler({ orderHash: ORDER_HASH });

        expect(seen.acceptance).toEqual([{ orderHash: ORDER_HASH, tokenId: null }]);
    });

    it('keep an explicit Cell exactly as it was passed', async () => {
        const seen = emptySeen();
        const handler = capture(registerAcceptCellOfferTool, contextWith(seen));

        await handler({ orderHash: ORDER_HASH, tokenId: TOKEN_ID });

        expect(seen.acceptance).toEqual([{ orderHash: ORDER_HASH, tokenId: TOKEN_ID }]);
    });

    it('turn an absent cursor into the first page rather than undefined', async () => {
        const seen = emptySeen();
        const handler = capture(registerGetMyListingsTool, contextWith(seen));

        await handler({});

        expect(seen.listingsCursor).toEqual([null]);
    });

    it('turn an absent reserved buyer into a public listing', async () => {
        const seen = emptySeen();
        const handler = capture(registerListCellTool, contextWith(seen));

        await handler({ tokenId: TOKEN_ID, price: '1000', expirationTime: 1_800_000_000 });

        expect(seen.listing).toEqual([
            { tokenId: TOKEN_ID, price: '1000', expirationTime: 1_800_000_000, buyerAddress: null },
        ]);
    });

    it('refuse a malformed order hash before the service can act on it', async () => {
        const seen = emptySeen();
        const handler = capture(registerCancelOrderTool, contextWith(seen));

        await expect(handler({ orderHash: '0xnope' })).rejects.toThrow();
        expect(seen.cancellation).toEqual([]);
    });

    it('refuse a Cell id with a leading zero, so one Cell keeps one identity', async () => {
        const seen = emptySeen();
        const handler = capture(registerAcceptCellOfferTool, contextWith(seen));

        await expect(handler({ orderHash: ORDER_HASH, tokenId: '01234' })).rejects.toThrow();
        expect(seen.acceptance).toEqual([]);
    });
});
