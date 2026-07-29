import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    WALLET_ADDRESS,
    SYNDICATE,
    FakeAppConfig,
    FakeSyndicateRegistryClient,
    FakeWallet,
    confirmedTx,
    makeConfig,
    memberJoinedLog,
    memberLeftLog,
    syndicateCreatedLog,
    syndicateRevert,
} from './service-fakes.js';
import { ApiClient } from '../../api/client.js';
import type { ApiSyndicateCard, ApiSyndicateMemberView } from '../../api/types.js';
import { SyndicateSort } from '../../api/types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type { SessionManager } from '../../session/manager.js';
import type { WalletProvider } from '../../wallet/types.js';
import { SyndicateService } from '../syndicate.service.js';
import type { SyndicateRatesView, AppConfig } from '../types.js';

interface Reply {
    status: number;
    data: unknown;
}

class RoutedApi {
    public readonly calls: Array<{ path: string; authenticated: boolean }> = [];
    constructor(private readonly route: (path: string) => Reply) {}
    async request(path: string): Promise<Reply> {
        this.calls.push({ path, authenticated: false });
        return this.route(path);
    }
    async authenticatedRequest(path: string): Promise<Reply> {
        this.calls.push({ path, authenticated: true });
        return this.route(path);
    }
}

function cardWire(over: Partial<ApiSyndicateCard> = {}): ApiSyndicateCard {
    return {
        id: '1',
        manager: '0x00000000000000000000000000000000000000a1',
        name: 'Iron Pact',
        link: 'https://example.test/iron',
        rates: { tradeDiscountBp: 250, transportDiscountBp: 500, tradeTaxBp: 100, transportTaxBp: 0 },
        memberCount: 2,
        createdAt: 1_700_000_000,
        ...over,
    };
}

function makeService(route: (path: string) => Reply): { service: SyndicateService; api: RoutedApi } {
    const { service, api } = makeWriteService({ route });
    return { service, api };
}

function makeWriteService(
    opts: Partial<{
        route: (path: string) => Reply;
        registry: FakeSyndicateRegistryClient;
        config: AppConfig;
        walletChainId: number;
    }>,
): { service: SyndicateService; api: RoutedApi; registry: FakeSyndicateRegistryClient } {
    const api = new RoutedApi(opts.route ?? (() => ({ status: 200, data: cardWire() })));
    const wallet = new FakeWallet(opts.walletChainId ?? 1);
    const registry = opts.registry ?? new FakeSyndicateRegistryClient();
    const service = new SyndicateService({
        api: api as unknown as ApiClient,
        wallet: wallet as unknown as WalletProvider,
        appConfig: new FakeAppConfig(opts.config ?? makeConfig()),
        registry,
        logger: new NoopLogger(),
    });
    return { service, api, registry };
}

function darkConfig(): AppConfig {
    const config = makeConfig();
    return { ...config, contracts: { ...config.contracts, syndicate: null } };
}

describe('SyndicateService.listSyndicates', () => {
    it('passes filters/sort through and converts bp rates to percent', async () => {
        const { service, api } = makeService(() => ({ status: 200, data: [cardWire()] }));

        const cards = await service.listSyndicates({
            name: 'iron',
            minMembers: 2,
            maxMembers: null,
            sort: SyndicateSort.MembersDesc,
            limit: 10,
            offset: null,
        });

        expect(api.calls[0]?.path).toBe('/api/v1/syndicates?name=iron&minMembers=2&sort=members_desc&limit=10');
        expect(cards[0]?.rates).toEqual({
            tradeDiscountPercent: 2.5,
            transportDiscountPercent: 5,
            tradeTaxPercent: 1,
            transportTaxPercent: 0,
        });
    });

    it('returns an empty catalog when the server has none', async () => {
        const { service } = makeService(() => ({ status: 200, data: [] }));
        expect(await service.listSyndicates(query())).toEqual([]);
    });

    it('throws on a non-200 catalog response', async () => {
        const { service } = makeService(() => ({ status: 500, data: { message: 'boom' } }));
        await expect(service.listSyndicates(query())).rejects.toThrow(/Failed to list syndicates/i);
    });
});

describe('SyndicateService.getSyndicate', () => {
    it('fetches the card plus a members page and preserves the API member order', async () => {
        const members: Array<ApiSyndicateMemberView> = [
            { address: '0x00000000000000000000000000000000000000b1', joinedAt: 100 },
            { address: '0x00000000000000000000000000000000000000b2', joinedAt: 200 },
        ];
        const { service, api } = makeService((path) =>
            path.includes('/members') ? { status: 200, data: members } : { status: 200, data: cardWire() },
        );

        const detail = await service.getSyndicate({ id: '1', membersLimit: 50, membersOffset: 0 });

        expect(api.calls.map((c) => c.path)).toEqual([
            '/api/v1/syndicates/1',
            '/api/v1/syndicates/1/members?limit=50&offset=0',
        ]);
        expect(detail.card.id).toBe('1');
        expect(detail.members.map((m) => m.address)).toEqual([
            '0x00000000000000000000000000000000000000b1',
            '0x00000000000000000000000000000000000000b2',
        ]);
    });

    it('surfaces an empty members page for a page past the end', async () => {
        const { service } = makeService((path) =>
            path.includes('/members') ? { status: 200, data: [] } : { status: 200, data: cardWire() },
        );
        const detail = await service.getSyndicate({ id: '1', membersLimit: null, membersOffset: null });
        expect(detail.members).toEqual([]);
    });

    it('throws a clear error naming the unknown id on a 404 card', async () => {
        const { service } = makeService(() => ({ status: 404, data: { message: 'SyndicateNotFound' } }));
        await expect(service.getSyndicate({ id: '999', membersLimit: null, membersOffset: null })).rejects.toThrow(
            /No syndicate with id 999/i,
        );
    });
});

describe('SyndicateService.getMembership', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('defaults to the wallet address and reports a non-member (200 + null) as not an error', async () => {
        const { service, api } = makeService(() => ({ status: 200, data: null }));

        const membership = await service.getMembership({ address: null });

        expect(api.calls[0]?.path).toBe(`/api/v1/syndicates/player/${encodeURIComponent(WALLET_ADDRESS)}`);
        expect(membership).toEqual({
            address: WALLET_ADDRESS,
            member: false,
            syndicateId: null,
            joinedAt: null,
            leaveAvailableAt: null,
            syndicate: null,
        });
    });

    it('reads an empty 200 body from the live wire as a non-member, not a "server down" error', async () => {
        const fetchMock = vi.fn(async () => new Response('', { status: 200 }));
        vi.stubGlobal('fetch', fetchMock);

        const api = new ApiClient({
            baseUrl: 'https://api.test',
            session: {} as SessionManager,
            logger: new NoopLogger(),
        });
        const service = new SyndicateService({
            api,
            wallet: new FakeWallet(1) as unknown as WalletProvider,
            appConfig: new FakeAppConfig(makeConfig()),
            registry: new FakeSyndicateRegistryClient(),
            logger: new NoopLogger(),
        });

        const membership = await service.getMembership({ address: null });

        expect(fetchMock).toHaveBeenCalledWith(
            `https://api.test/api/v1/syndicates/player/${encodeURIComponent(WALLET_ADDRESS)}`,
            expect.anything(),
        );
        expect(membership).toEqual({
            address: WALLET_ADDRESS,
            member: false,
            syndicateId: null,
            joinedAt: null,
            leaveAvailableAt: null,
            syndicate: null,
        });
    });

    it('enriches a member with their syndicate card and rates in percent', async () => {
        const { service, api } = makeService((path) =>
            path.includes('/player/')
                ? { status: 200, data: { syndicateId: '1', joinedAt: 100, leaveAvailableAt: 700 } }
                : { status: 200, data: cardWire({ id: '1' }) },
        );

        const membership = await service.getMembership({ address: '0x00000000000000000000000000000000000000c1' });

        expect(api.calls.map((c) => c.path)).toEqual([
            '/api/v1/syndicates/player/0x00000000000000000000000000000000000000c1',
            '/api/v1/syndicates/1',
        ]);
        expect(membership.member).toBe(true);
        expect(membership.syndicateId).toBe('1');
        expect(membership.joinedAt).toBe(100);
        expect(membership.leaveAvailableAt).toBe(700);
        expect(membership.syndicate?.rates.tradeDiscountPercent).toBe(2.5);
    });

    it('throws on a non-200, non-null membership response', async () => {
        const { service } = makeService(() => ({ status: 503, data: { message: 'down' } }));
        await expect(service.getMembership({ address: '0xabc' })).rejects.toThrow(
            /Failed to read syndicate membership/i,
        );
    });
});

describe('SyndicateService.join', () => {
    it('joins, derives leaveAvailableAt from the receipt joinedAt plus the cooldown, and names/rates from the card', async () => {
        const registry = new FakeSyndicateRegistryClient({
            join: confirmedTx([
                memberJoinedLog({ player: WALLET_ADDRESS, id: 1n, joinedAt: 1_000n, registry: SYNDICATE }),
            ]),
            config: { exitCooldownSec: 600 },
        });
        const { service, registry: reg } = makeWriteService({
            route: () => ({ status: 200, data: cardWire({ id: '1' }) }),
            registry,
        });

        const result = await service.join({ id: '1' });

        expect(reg.joinCalls).toEqual([{ registry: SYNDICATE, id: 1n }]);
        expect(result).toEqual({
            syndicateId: '1',
            joinedAt: 1_000,
            leaveAvailableAt: 1_600,
            name: 'Iron Pact',
            rates: {
                tradeDiscountPercent: 2.5,
                transportDiscountPercent: 5,
                tradeTaxPercent: 1,
                transportTaxPercent: 0,
            },
        });
    });

    it('still returns a successful result when the post-tx card read fails (projection lag)', async () => {
        const registry = new FakeSyndicateRegistryClient({
            join: confirmedTx([
                memberJoinedLog({ player: WALLET_ADDRESS, id: 1n, joinedAt: 1_000n, registry: SYNDICATE }),
            ]),
            config: { exitCooldownSec: 600 },
        });
        const { service, registry: reg } = makeWriteService({
            route: () => ({ status: 404, data: { message: 'SyndicateNotFound' } }),
            registry,
        });

        const result = await service.join({ id: '1' });

        expect(reg.joinCalls).toEqual([{ registry: SYNDICATE, id: 1n }]);
        expect(result).toEqual({
            syndicateId: '1',
            joinedAt: 1_000,
            leaveAvailableAt: 1_600,
            name: null,
            rates: null,
        });
    });

    it('rewrites AlreadyInSyndicate into a message naming the current syndicate from HTTP membership', async () => {
        const registry = new FakeSyndicateRegistryClient({ join: syndicateRevert('AlreadyInSyndicate') });
        const { service } = makeWriteService({
            route: (path) =>
                path.includes('/player/')
                    ? { status: 200, data: { syndicateId: '2', joinedAt: 100, leaveAvailableAt: 700 } }
                    : { status: 200, data: cardWire({ id: '2', name: 'Copper Cartel' }) },
            registry,
        });

        await expect(service.join({ id: '1' })).rejects.toThrow(/already in syndicate 2 "Copper Cartel"/i);
    });

    it('rewrites SyndicateNotFound into a plain message naming the unknown id', async () => {
        const registry = new FakeSyndicateRegistryClient({ join: syndicateRevert('SyndicateNotFound') });
        const { service } = makeWriteService({ registry });
        await expect(service.join({ id: '999' })).rejects.toThrow(/No syndicate with id 999/i);
    });

    it('refuses before any transaction when the registry is not deployed', async () => {
        const registry = new FakeSyndicateRegistryClient();
        const { service } = makeWriteService({ registry, config: darkConfig() });

        await expect(service.join({ id: '1' })).rejects.toThrow(/not deployed/i);
        expect(registry.joinCalls).toEqual([]);
    });
});

describe('SyndicateService.leave', () => {
    it('leaves and reports the syndicate id plus immediate re-join', async () => {
        const registry = new FakeSyndicateRegistryClient({
            leave: confirmedTx([memberLeftLog({ player: WALLET_ADDRESS, id: 1n, registry: SYNDICATE })]),
        });
        const { service, registry: reg } = makeWriteService({ registry });

        const result = await service.leave();

        expect(reg.leaveCalls).toEqual([{ registry: SYNDICATE }]);
        expect(result).toEqual({ syndicateId: '1', rejoinAvailableImmediately: true });
    });

    it('rewrites an early-leave CooldownActive into a message carrying the leave-available time', async () => {
        const registry = new FakeSyndicateRegistryClient({ leave: syndicateRevert('CooldownActive') });
        const { service } = makeWriteService({
            route: (path) =>
                path.includes('/player/')
                    ? { status: 200, data: { syndicateId: '1', joinedAt: 100, leaveAvailableAt: 700 } }
                    : { status: 200, data: cardWire({ id: '1' }) },
            registry,
        });

        await expect(service.leave()).rejects.toThrow(/cannot leave yet.*unix 700/is);
    });

    it('rewrites NotInSyndicate into a plain "nothing to leave" message', async () => {
        const registry = new FakeSyndicateRegistryClient({ leave: syndicateRevert('NotInSyndicate') });
        const { service } = makeWriteService({ registry });
        await expect(service.leave()).rejects.toThrow(/not a member of any syndicate/i);
    });

    it('refuses before any transaction when the registry is not deployed', async () => {
        const registry = new FakeSyndicateRegistryClient();
        const { service } = makeWriteService({ registry, config: darkConfig() });

        await expect(service.leave()).rejects.toThrow(/not deployed/i);
        expect(registry.leaveCalls).toEqual([]);
    });
});

function rates(over: Partial<SyndicateRatesView> = {}): SyndicateRatesView {
    return {
        tradeDiscountPercent: 2.5,
        transportDiscountPercent: 5,
        tradeTaxPercent: 1,
        transportTaxPercent: 0,
        ...over,
    };
}

const RATES_BP = { tradeDiscountBp: 250, transportDiscountBp: 500, tradeTaxBp: 100, transportTaxBp: 0 };

describe('SyndicateService.create', () => {
    it('creates with the caller as the default manager and builds the result from the receipt, input, and cached cooldown', async () => {
        const registry = new FakeSyndicateRegistryClient({
            create: confirmedTx([
                syndicateCreatedLog({
                    id: 7n,
                    creator: WALLET_ADDRESS,
                    manager: WALLET_ADDRESS,
                    name: 'Iron Pact',
                    link: '',
                    ratesBp: [250, 500, 100, 0],
                    createdAt: 1_000n,
                    registry: SYNDICATE,
                }),
                memberJoinedLog({ player: WALLET_ADDRESS, id: 7n, joinedAt: 1_000n, registry: SYNDICATE }),
            ]),
            config: { exitCooldownSec: 600 },
        });
        const { service, registry: reg, api } = makeWriteService({ registry });

        const result = await service.create({ name: 'Iron Pact', link: '', manager: null, rates: rates() });

        expect(reg.createCalls).toEqual([
            { registry: SYNDICATE, name: 'Iron Pact', link: '', manager: WALLET_ADDRESS, rates: RATES_BP },
        ]);
        expect(result).toEqual({
            syndicateId: '7',
            manager: WALLET_ADDRESS,
            name: 'Iron Pact',
            link: '',
            rates: rates(),
            joinedAt: 1_000,
            leaveAvailableAt: 1_600,
        });
        expect(api.calls).toEqual([]);
    });

    it('uses an explicit manager address when provided', async () => {
        const manager = '0x00000000000000000000000000000000000000a1';
        const registry = new FakeSyndicateRegistryClient({
            create: confirmedTx([
                syndicateCreatedLog({
                    id: 8n,
                    creator: WALLET_ADDRESS,
                    manager: manager as `0x${string}`,
                    name: 'Copper Cartel',
                    link: 'https://example.test/c',
                    ratesBp: [250, 500, 100, 0],
                    createdAt: 2_000n,
                    registry: SYNDICATE,
                }),
                memberJoinedLog({ player: WALLET_ADDRESS, id: 8n, joinedAt: 2_000n, registry: SYNDICATE }),
            ]),
            config: { exitCooldownSec: 0 },
        });
        const { service, registry: reg } = makeWriteService({ registry });

        const result = await service.create({
            name: 'Copper Cartel',
            link: 'https://example.test/c',
            manager,
            rates: rates(),
        });

        expect(reg.createCalls[0]?.manager).toBe(manager);
        expect(result.manager).toBe(manager);
        expect(result.syndicateId).toBe('8');
        expect(result.leaveAvailableAt).toBe(2_000);
    });

    it('rejects a rate finer than one basis point before any transaction', async () => {
        const registry = new FakeSyndicateRegistryClient();
        const { service } = makeWriteService({ registry });

        await expect(
            service.create({ name: 'X', link: '', manager: null, rates: rates({ tradeDiscountPercent: 2.555 }) }),
        ).rejects.toThrow(/basis point/i);
        expect(registry.createCalls).toEqual([]);
    });

    it('rejects a rate above 100% before any transaction', async () => {
        const registry = new FakeSyndicateRegistryClient();
        const { service } = makeWriteService({ registry });

        await expect(
            service.create({ name: 'X', link: '', manager: null, rates: rates({ tradeTaxPercent: 150 }) }),
        ).rejects.toThrow(/trade tax rate must be between 0% and 100%/i);
        expect(registry.createCalls).toEqual([]);
    });

    it('rewrites an AlreadyInSyndicate revert into a clear error naming the current syndicate (nothing created)', async () => {
        const registry = new FakeSyndicateRegistryClient({ create: syndicateRevert('AlreadyInSyndicate') });
        const { service } = makeWriteService({
            route: (path) =>
                path.includes('/player/')
                    ? { status: 200, data: { syndicateId: '2', joinedAt: 100, leaveAvailableAt: 700 } }
                    : { status: 200, data: cardWire({ id: '2', name: 'Copper Cartel' }) },
            registry,
        });

        await expect(service.create({ name: 'X', link: '', manager: null, rates: rates() })).rejects.toThrow(
            /already in syndicate 2 "Copper Cartel"/i,
        );
    });

    it('rewrites a RateTooHigh revert into a cap message', async () => {
        const registry = new FakeSyndicateRegistryClient({ create: syndicateRevert('RateTooHigh') });
        const { service } = makeWriteService({ registry });
        await expect(service.create({ name: 'X', link: '', manager: null, rates: rates() })).rejects.toThrow(
            /100% cap/i,
        );
    });

    it('rewrites a NameTooLong revert into a clear name-cap message', async () => {
        const registry = new FakeSyndicateRegistryClient({ create: syndicateRevert('NameTooLong') });
        const { service } = makeWriteService({ registry });
        await expect(service.create({ name: 'X', link: '', manager: null, rates: rates() })).rejects.toThrow(
            /name is too long/i,
        );
    });

    it('refuses before any transaction when the registry is not deployed', async () => {
        const registry = new FakeSyndicateRegistryClient();
        const { service } = makeWriteService({ registry, config: darkConfig() });

        await expect(service.create({ name: 'X', link: '', manager: null, rates: rates() })).rejects.toThrow(
            /not deployed/i,
        );
        expect(registry.createCalls).toEqual([]);
    });
});

describe('SyndicateService.setParams', () => {
    it('sends the full replacement state and echoes it back without a post-tx card read', async () => {
        const registry = new FakeSyndicateRegistryClient({ setParams: confirmedTx([]) });
        const { service, registry: reg, api } = makeWriteService({ registry });

        const result = await service.setParams({
            id: '5',
            name: 'Iron Pact',
            link: 'https://example.test/i',
            rates: rates(),
        });

        expect(reg.setParamsCalls).toEqual([
            { registry: SYNDICATE, id: 5n, name: 'Iron Pact', link: 'https://example.test/i', rates: RATES_BP },
        ]);
        expect(result).toEqual({
            syndicateId: '5',
            name: 'Iron Pact',
            link: 'https://example.test/i',
            rates: rates(),
        });
        expect(api.calls).toEqual([]);
    });

    it('rewrites a NotManager revert into a manager-only message', async () => {
        const registry = new FakeSyndicateRegistryClient({ setParams: syndicateRevert('NotManager') });
        const { service } = makeWriteService({ registry });
        await expect(service.setParams({ id: '5', name: 'X', link: '', rates: rates() })).rejects.toThrow(
            /only the syndicate manager/i,
        );
    });

    it('refuses before any transaction when the registry is not deployed', async () => {
        const registry = new FakeSyndicateRegistryClient();
        const { service } = makeWriteService({ registry, config: darkConfig() });

        await expect(service.setParams({ id: '5', name: 'X', link: '', rates: rates() })).rejects.toThrow(
            /not deployed/i,
        );
        expect(registry.setParamsCalls).toEqual([]);
    });
});

describe('SyndicateService.transferManager', () => {
    it('transfers to the successor and reports the caller as the previous manager', async () => {
        const next = '0x00000000000000000000000000000000000000d1';
        const registry = new FakeSyndicateRegistryClient({ transferManager: confirmedTx([]) });
        const { service, registry: reg } = makeWriteService({ registry });

        const result = await service.transferManager({ id: '5', next });

        expect(reg.transferManagerCalls).toEqual([{ registry: SYNDICATE, id: 5n, next }]);
        expect(result).toEqual({ syndicateId: '5', previousManager: WALLET_ADDRESS, newManager: next });
    });

    it('rewrites a NotManager revert into a manager-only message', async () => {
        const registry = new FakeSyndicateRegistryClient({ transferManager: syndicateRevert('NotManager') });
        const { service } = makeWriteService({ registry });
        await expect(
            service.transferManager({ id: '5', next: '0x00000000000000000000000000000000000000d1' }),
        ).rejects.toThrow(/only the syndicate manager/i);
    });

    it('rewrites a ZeroAddress revert into a clear successor message', async () => {
        const registry = new FakeSyndicateRegistryClient({ transferManager: syndicateRevert('ZeroAddress') });
        const { service } = makeWriteService({ registry });
        await expect(
            service.transferManager({ id: '5', next: '0x0000000000000000000000000000000000000000' }),
        ).rejects.toThrow(/successor address cannot be the zero address/i);
    });

    it('refuses before any transaction when the registry is not deployed', async () => {
        const registry = new FakeSyndicateRegistryClient();
        const { service } = makeWriteService({ registry, config: darkConfig() });

        await expect(
            service.transferManager({ id: '5', next: '0x00000000000000000000000000000000000000d1' }),
        ).rejects.toThrow(/not deployed/i);
        expect(registry.transferManagerCalls).toEqual([]);
    });
});

function query(): {
    name: null;
    minMembers: null;
    maxMembers: null;
    sort: null;
    limit: null;
    offset: null;
} {
    return { name: null, minMembers: null, maxMembers: null, sort: null, limit: null, offset: null };
}
