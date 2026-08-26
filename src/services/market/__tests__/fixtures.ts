import type { RequestOptions } from '../../../api/client.js';
import type { ApiResponse } from '../../../api/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { MarketApiClient } from '../client.js';
import { MarketService } from '../service.js';
import { MarketOfferKind, type IMarketTransport } from '../types.js';

export const CURRENCY = { address: `0x${'c'.repeat(40)}`, symbol: 'WETH', decimals: 18 };

export const PROTOCOL_ADDRESS = '0x0000000000000068F116a894984e2DB1123eB395';

export const MAKER = `0x${'1'.repeat(40)}`;

export const OTHER_MAKER = `0x${'2'.repeat(40)}`;

export const LISTING_HASH = `0x${'a'.repeat(64)}`;

export const OFFER_HASH = `0x${'b'.repeat(64)}`;

export const listingWire = {
    orderHash: LISTING_HASH,
    protocolAddress: PROTOCOL_ADDRESS,
    chainId: 4663,
    maker: MAKER,
    tokenId: '1234',
    price: '1500000000000000000',
    currency: CURRENCY,
    startTime: 1_800_000_000,
    expirationTime: 1_800_086_400,
};

export function offerWire(kind: MarketOfferKind, tokenId: string | null): Record<string, unknown> {
    return {
        orderHash: OFFER_HASH,
        protocolAddress: PROTOCOL_ADDRESS,
        chainId: 4663,
        maker: OTHER_MAKER,
        kind,
        tokenId,
        amount: '900000000000000000',
        currency: CURRENCY,
        startTime: 1_800_000_000,
        expirationTime: 1_800_086_400,
    };
}

export const snapshotWire = {
    tokenId: '1234',
    bestListing: listingWire,
    bestOffer: offerWire(MarketOfferKind.Item, '1234'),
};

export const emptySnapshotWire = { tokenId: '1234', bestListing: null, bestOffer: null };

export interface FakeReply {
    status: number;
    data: unknown;
    headers: Record<string, string>;
}

export function reply(status: number, data: unknown, headers: Record<string, string> = {}): FakeReply {
    return { status, data, headers };
}

export interface RecordedMarketCall {
    path: string;
    method: string;
    body: unknown;
}

export class FakeMarketTransport implements IMarketTransport {
    readonly calls: Array<RecordedMarketCall> = [];
    private readonly replies: Array<FakeReply | Error>;
    private readonly fallback: FakeReply | Error;

    constructor(replies: Array<FakeReply | Error>, fallback: FakeReply | Error | null = null) {
        this.replies = [...replies];
        this.fallback = fallback ?? replies[replies.length - 1] ?? reply(200, null);
    }

    async authenticatedRequest<T>(path: string, options: RequestOptions | null): Promise<ApiResponse<T>> {
        this.calls.push({ path, method: options?.method ?? 'GET', body: options?.body ?? null });
        const next = this.replies.shift() ?? this.fallback;
        if (next instanceof Error) {
            throw next;
        }
        return { status: next.status, headers: new Headers(next.headers), data: next.data as T };
    }
}

export function marketServiceOver(transport: IMarketTransport): MarketService {
    const logger = new NoopLogger();
    return new MarketService({ client: new MarketApiClient({ api: transport, logger }), logger });
}
