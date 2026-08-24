import { describe, expect, it } from 'vitest';

import { FakeAppConfig, FakeWallet, WALLET_ADDRESS, makeConfig } from './service-fakes.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type { WalletProvider } from '../../wallet/types.js';
import { LotTermsService } from '../lot-terms.service.js';
import type { ListingPreflightInput } from '../lot-terms.types.js';
import {
    LotListingBlocker,
    type GetSaleFeeParams,
    type GetTradeConfigParams,
    type ITradeClient,
    type LotBoundParams,
    type OnChainTradeConfig,
    type SellerEvictedCountParams,
    type SellerLotCountParams,
} from '../types.js';

const HUB = '4100';
const OTHER_HUB = '4200';
const RESOURCE = 5;
const OTHER_RESOURCE = 6;
const OTHER_SELLER = '0x00000000000000000000000000000000000000ff';

/**
 * Deliberately unrelated to every window below: a preflight that reaches for the shares or the uncapped
 * pair instead of the dedicated bound views lands on a number no test expects.
 */
const CHAIN_CONFIG: OnChainTradeConfig = {
    minPricePerUnit: 250_000_000_000_000_000n,
    saleBurnPercent: 1,
    minLotShareBp: 10,
    maxLotShareBp: 200,
    maxLotsPerSellerResource: 3,
    minUncappedLotValue: 999_001n,
    maxUncappedLotValue: 999_002n,
};

interface World {
    min: Record<string, bigint>;
    max: Record<string, bigint>;
    lotCount: Record<string, bigint>;
    evicted: Record<string, bigint>;
    saleFeeBp: Record<string, number>;
    config: OnChainTradeConfig;
}

const pair = (hub: bigint, res: number): string => `${hub.toString()}|${res}`;
const triple = (seller: string, hub: bigint, res: number): string => `${seller.toLowerCase()}|${hub.toString()}|${res}`;
const sellerHub = (seller: string, hub: bigint): string => `${seller.toLowerCase()}|${hub.toString()}`;

function makeWorld(overrides: Partial<World> = {}): World {
    return {
        config: CHAIN_CONFIG,
        min: { [pair(BigInt(HUB), RESOURCE)]: 100n, [pair(BigInt(OTHER_HUB), RESOURCE)]: 100n },
        max: { [pair(BigInt(HUB), RESOURCE)]: 400n, [pair(BigInt(OTHER_HUB), RESOURCE)]: 400n },
        lotCount: {},
        evicted: {},
        saleFeeBp: {},
        ...overrides,
    };
}

class FakeTradeViews {
    public readonly reads: Array<string> = [];

    constructor(private readonly world: World) {}

    async getConfig(params: GetTradeConfigParams): Promise<OnChainTradeConfig> {
        this.reads.push(`getConfig(${params.trade})`);
        return this.world.config;
    }
    async getMinLotValue(params: LotBoundParams): Promise<bigint> {
        this.reads.push(`getMinLotValue(${params.hub},${params.res})`);
        return this.world.min[pair(params.hub, params.res)] ?? 0n;
    }
    async getMaxLotValue(params: LotBoundParams): Promise<bigint> {
        this.reads.push(`getMaxLotValue(${params.hub},${params.res})`);
        return this.world.max[pair(params.hub, params.res)] ?? 0n;
    }
    async getSellerLotCount(params: SellerLotCountParams): Promise<bigint> {
        this.reads.push(`getSellerLotCount(${params.seller},${params.hub},${params.res})`);
        return this.world.lotCount[triple(params.seller, params.hub, params.res)] ?? 0n;
    }
    async getSellerEvictedCount(params: SellerEvictedCountParams): Promise<bigint> {
        this.reads.push(`getSellerEvictedCount(${params.seller},${params.hub})`);
        return this.world.evicted[sellerHub(params.seller, params.hub)] ?? 0n;
    }
    async getSaleFee(params: GetSaleFeeParams): Promise<number> {
        this.reads.push(`getSaleFee(${params.hub},${params.res})`);
        return this.world.saleFeeBp[pair(params.hub, params.res)] ?? 0;
    }
}

function makeService(world: World = makeWorld()): { service: LotTermsService; client: FakeTradeViews } {
    const client = new FakeTradeViews(world);
    const service = new LotTermsService({
        appConfig: new FakeAppConfig(makeConfig()),
        wallet: new FakeWallet(1) as unknown as WalletProvider,
        tradeClient: client as unknown as ITradeClient,
        logger: new NoopLogger(),
    });
    return { service, client };
}

const listing = (overrides: Partial<ListingPreflightInput> = {}): ListingPreflightInput => ({
    hubTokenId: HUB,
    resourceId: RESOURCE,
    value: '100',
    pricePerUnit: '0.5',
    maxSaleFeePercent: null,
    ...overrides,
});

describe('LotTermsService terms read', () => {
    it('reports the window, the counts and the limit from the dedicated views', async () => {
        const world = makeWorld({ lotCount: { [triple(WALLET_ADDRESS, BigInt(HUB), RESOURCE)]: 1n } });
        const { service } = makeService(world);

        expect(await service.getLotTerms({ hubTokenId: HUB, resourceId: RESOURCE })).toEqual({
            hubTokenId: HUB,
            resourceId: RESOURCE,
            sellerAddress: WALLET_ADDRESS,
            effectiveMin: '100',
            effectiveMax: '400',
            sellerLotCount: 1,
            sellerLotLimit: 3,
            outstandingEvictedCount: 0,
            canList: true,
            blockers: [],
        });
    });

    it('asks the bound views for this hub and resource', async () => {
        const { service, client } = makeService();

        await service.getLotTerms({ hubTokenId: HUB, resourceId: RESOURCE });

        expect(client.reads).toContain(`getMinLotValue(${HUB},${RESOURCE})`);
        expect(client.reads).toContain(`getMaxLotValue(${HUB},${RESOURCE})`);
    });

    it('counts the seller lots for the exact seller, hub and resource tuple', async () => {
        const world = makeWorld({ lotCount: { [triple(WALLET_ADDRESS, BigInt(HUB), RESOURCE)]: 2n } });
        const { service, client } = makeService(world);

        const terms = await service.getLotTerms({ hubTokenId: HUB, resourceId: RESOURCE });

        expect(terms.sellerLotCount).toBe(2);
        expect(client.reads).toContain(`getSellerLotCount(${WALLET_ADDRESS},${HUB},${RESOURCE})`);
    });

    it('blocks every resource of a hub the seller still owes an evicted return on', async () => {
        const world = makeWorld({ evicted: { [sellerHub(WALLET_ADDRESS, BigInt(HUB))]: 1n } });
        const { service } = makeService(world);

        const other = await service.getLotTerms({ hubTokenId: HUB, resourceId: OTHER_RESOURCE });

        expect(other.outstandingEvictedCount).toBe(1);
        expect(other.canList).toBe(false);
        expect(other.blockers).toContain(LotListingBlocker.EvictedPending);
    });

    it('leaves another hub and another seller free of that block', async () => {
        const world = makeWorld({
            evicted: {
                [sellerHub(WALLET_ADDRESS, BigInt(HUB))]: 1n,
                [sellerHub(OTHER_SELLER, BigInt(OTHER_HUB))]: 4n,
            },
        });
        const { service } = makeService(world);

        const elsewhere = await service.getLotTerms({ hubTokenId: OTHER_HUB, resourceId: RESOURCE });

        expect(elsewhere.outstandingEvictedCount).toBe(0);
        expect(elsewhere.canList).toBe(true);
        expect(elsewhere.blockers).toEqual([]);
    });

    it('reports an empty window as its own blocker rather than an impossible amount', async () => {
        const world = makeWorld({ max: { [pair(BigInt(HUB), RESOURCE)]: 0n } });
        const { service } = makeService(world);

        const terms = await service.getLotTerms({ hubTokenId: HUB, resourceId: RESOURCE });

        expect(terms.canList).toBe(false);
        expect(terms.blockers).toContain(LotListingBlocker.EmptyWindow);
    });

    it('reports an exhausted seller slot count as a blocker at the limit, not one lot later', async () => {
        const world = makeWorld({ lotCount: { [triple(WALLET_ADDRESS, BigInt(HUB), RESOURCE)]: 3n } });
        const { service } = makeService(world);

        const terms = await service.getLotTerms({ hubTokenId: HUB, resourceId: RESOURCE });

        expect(terms.sellerLotCount).toBe(3);
        expect(terms.sellerLotLimit).toBe(3);
        expect(terms.canList).toBe(false);
        expect(terms.blockers).toContain(LotListingBlocker.SellerLotLimit);
    });

    it('still allows a listing one slot below the limit', async () => {
        const world = makeWorld({ lotCount: { [triple(WALLET_ADDRESS, BigInt(HUB), RESOURCE)]: 2n } });
        const { service } = makeService(world);

        expect((await service.getLotTerms({ hubTokenId: HUB, resourceId: RESOURCE })).canList).toBe(true);
    });
});

describe('LotTermsService listing preflight', () => {
    it('accepts the exact minimum and the exact maximum', async () => {
        const { service } = makeService();

        await expect(service.assertListingAllowed(listing({ value: '100' }))).resolves.toMatchObject({
            effectiveMin: '100',
        });
        await expect(service.assertListingAllowed(listing({ value: '400' }))).resolves.toMatchObject({
            effectiveMax: '400',
        });
    });

    it('refuses one unit below the minimum and names the live bound and the fix', async () => {
        const { service } = makeService();

        await expect(service.assertListingAllowed(listing({ value: '99' }))).rejects.toThrow(
            /99 units.*below the live minimum of 100 units.*List at least 100/s,
        );
    });

    it('refuses one unit above the maximum and names the live bound and the fix', async () => {
        const { service } = makeService();

        await expect(service.assertListingAllowed(listing({ value: '401' }))).rejects.toThrow(
            /401 units.*above the live maximum of 400 units.*List at most 400/s,
        );
    });

    it('refuses at the seller slot limit and names the live count, the limit and the fix', async () => {
        const world = makeWorld({ lotCount: { [triple(WALLET_ADDRESS, BigInt(HUB), RESOURCE)]: 3n } });
        const { service } = makeService(world);

        await expect(service.assertListingAllowed(listing())).rejects.toThrow(
            /3 of 3 live lots.*delivering, open and evicted.*return one remainder/s,
        );
    });

    it('refuses an evicted-pending hub and names the count, the hub and the fix', async () => {
        const world = makeWorld({ evicted: { [sellerHub(WALLET_ADDRESS, BigInt(HUB))]: 2n } });
        const { service } = makeService(world);

        await expect(service.assertListingAllowed(listing({ resourceId: OTHER_RESOURCE }))).rejects.toThrow(
            new RegExp(`2 evicted lot.*hub ${HUB}.*return`, 's'),
        );
    });

    it('refuses an asking price under the live floor', async () => {
        const { service } = makeService();

        await expect(service.assertListingAllowed(listing({ pricePerUnit: '0.2' }))).rejects.toThrow(
            /below the live floor of 0.25/,
        );
    });

    it('refuses a sale fee above the seller tolerance and names both rates', async () => {
        const world = makeWorld({ saleFeeBp: { [pair(BigInt(HUB), RESOURCE)]: 500 } });
        const { service } = makeService(world);

        await expect(service.assertListingAllowed(listing({ maxSaleFeePercent: 4 }))).rejects.toThrow(
            /charges 5%.*tolerance of 4%/s,
        );
        await expect(service.assertListingAllowed(listing({ maxSaleFeePercent: 5 }))).resolves.toBeTruthy();
    });

    it('never reads the sale fee when no tolerance was given', async () => {
        const { service, client } = makeService();

        await service.assertListingAllowed(listing({ maxSaleFeePercent: null }));

        expect(client.reads.some((read) => read.startsWith('getSaleFee'))).toBe(false);
    });

    it('applies the contract priority: the evicted block outranks every amount problem', async () => {
        const world = makeWorld({
            evicted: { [sellerHub(WALLET_ADDRESS, BigInt(HUB))]: 1n },
            max: { [pair(BigInt(HUB), RESOURCE)]: 0n },
            lotCount: { [triple(WALLET_ADDRESS, BigInt(HUB), RESOURCE)]: 9n },
            saleFeeBp: { [pair(BigInt(HUB), RESOURCE)]: 9_000 },
        });
        const { service } = makeService(world);

        await expect(
            service.assertListingAllowed(listing({ value: '0', pricePerUnit: '0', maxSaleFeePercent: 0 })),
        ).rejects.toThrow(/evicted/i);
    });

    it('applies the contract priority: an unusable amount outranks the hub window', async () => {
        const world = makeWorld({ max: { [pair(BigInt(HUB), RESOURCE)]: 0n } });
        const { service } = makeService(world);

        await expect(service.assertListingAllowed(listing({ value: '0' }))).rejects.toThrow(
            /positive whole number of units/,
        );
    });

    it('applies the contract priority: the hub window outranks the minimum', async () => {
        const world = makeWorld({
            min: { [pair(BigInt(HUB), RESOURCE)]: 500n },
            max: { [pair(BigInt(HUB), RESOURCE)]: 400n },
        });
        const { service } = makeService(world);

        await expect(service.assertListingAllowed(listing({ value: '100' }))).rejects.toThrow(
            /no listing window for resource #5/,
        );
    });

    it('applies the contract priority: the minimum outranks the seller slot count', async () => {
        const world = makeWorld({ lotCount: { [triple(WALLET_ADDRESS, BigInt(HUB), RESOURCE)]: 3n } });
        const { service } = makeService(world);

        await expect(service.assertListingAllowed(listing({ value: '99' }))).rejects.toThrow(/below the live minimum/);
    });

    it('applies the contract priority: the seller slot count outranks the sale-fee tolerance', async () => {
        const world = makeWorld({
            lotCount: { [triple(WALLET_ADDRESS, BigInt(HUB), RESOURCE)]: 3n },
            saleFeeBp: { [pair(BigInt(HUB), RESOURCE)]: 5_000 },
        });
        const { service } = makeService(world);

        await expect(service.assertListingAllowed(listing({ maxSaleFeePercent: 0 }))).rejects.toThrow(/live lots/);
    });

    it('re-reads the live terms on every call rather than answering from the first read', async () => {
        const { service, client } = makeService();

        await service.assertListingAllowed(listing());
        const afterFirst = client.reads.length;
        await service.assertListingAllowed(listing());

        expect(afterFirst).toBeGreaterThan(0);
        expect(client.reads.length).toBe(afterFirst * 2);
    });
});
