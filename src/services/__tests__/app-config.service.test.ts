import { describe, expect, it } from 'vitest';

import type { ApiClient } from '../../api/client.js';
import {
    type AppConfigResponse,
    type BuildingView,
    BuildingKind,
    BuildingType,
    CraftRecipeId,
    RandomnessKind,
} from '../../api/types.js';
import { Network } from '../../config/types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { AppConfigService } from '../app-config.service.js';
import type { AppConfig, CatalogBuildingView } from '../types.js';

const CPU_HOOK = '0x4444444444444444444444444444444444444444';
const WETH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const USDG = '0x1111111111111111111111111111111111111111';
const CELL = '0x5555555555555555555555555555555555555555';
const ADAPTER = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';

class FakeApi {
    public readonly paths: Array<string> = [];

    constructor(private readonly response: { status: number; data: unknown }) {}

    async request(path: string): Promise<{ status: number; data: unknown }> {
        this.paths.push(path);
        return this.response;
    }
}

type AppConfigFixture = Required<AppConfigResponse>;

function makeResponse(overrides: Partial<AppConfigFixture> = {}): AppConfigFixture {
    return {
        network: Network.ROBINHOOD,
        chainId: 4663,
        contracts: {
            land: '0x3333333333333333333333333333333333333333',
            weth: WETH,
            usdg: USDG,
            cpuToken: '0x2222222222222222222222222222222222222222',
            cpuHook: CPU_HOOK,
            cell: CELL,
            cellLens: '0x6666666666666666666666666666666666666666',
            transport: '0x7777777777777777777777777777777777777777',
            trade: '0x8888888888888888888888888888888888888888',
            syndicate: '0x9999999999999999999999999999999999999999',
            ...overrides.contracts,
        },
        randomness: { kind: RandomnessKind.ENTROPY, adapter: ADAPTER },
        resources: { 5: 'Iron' },
        recipes: [],
        buildings: [
            {
                type: BuildingType.Mine,
                onChainId: 4,
                name: 'Mine',
                kind: BuildingKind.Extractor,
                tier: 1,
                radius: 0,
                buildCost: '5',
                buildTimeSec: 120,
                buildInputs: [],
                demolishCost: { cpu: '2.5', inputs: [] },
                modeSwitchCost: '1',
                minableResources: [5, 6],
                recipes: [],
                effects: { cycleTimeBp: 10000, extractionShareBp: 10000, inputEfficiency: [] },
                recipeOpexCpu: null,
                upgradeFrom: null,
                upgradeTo: [],
                family: null,
                level: null,
                branch: null,
            },
        ],
        reveal: { ethBudget: '1000', cpuBurn: '2000' },
        transport: { moveRadius: 1, hubRadius: 3, moveTimePerCellSec: 2, moveFeeFloors: { 5: '0.1' } },
        trade: { saleBurnPercent: 1, maxSaleFeeBp: 5000 },
        storage: { caps: [{ resourceId: 1, cellCap: 100, hubCap: 1000 }] },
        ...overrides,
    };
}

function makeService(api: FakeApi): AppConfigService {
    return new AppConfigService({
        api: api as unknown as ApiClient,
        network: Network.ROBINHOOD,
        logger: new NoopLogger(),
    });
}

describe('AppConfigService mode switch cost', () => {
    async function loadBuilding(modeSwitchCost: string | null | undefined): Promise<CatalogBuildingView> {
        const base = makeResponse();
        const [mine] = base.buildings;
        const row = { ...(mine as BuildingView), modeSwitchCost } as BuildingView;
        if (modeSwitchCost === undefined) {
            delete (row as Partial<BuildingView>).modeSwitchCost;
        }
        const config = await makeService(new FakeApi({ status: 200, data: { ...base, buildings: [row] } })).load();
        return config.buildings[0] as CatalogBuildingView;
    }

    it('reads a catalog that predates the field as unknown — not as impossible, and never as zero', async () => {
        const building = await loadBuilding(undefined);

        expect(building.modeSwitch).toEqual({ kind: 'unknown' });
        expect('modeSwitchCost' in building).toBe(false);
    });

    it('states "can never switch" positively without a price in the authoritative tagged view', async () => {
        const building = await loadBuilding(null);

        expect(building.modeSwitch).toEqual({ kind: 'impossible' });
        expect('costCpu' in building.modeSwitch).toBe(false);
        expect(building).toHaveProperty('modeSwitchCost', null);
        expect(JSON.stringify(building.modeSwitch)).not.toMatch(/costCpu/);
    });

    it('preserves the legacy price while making the possible tag authoritative', async () => {
        const building = await loadBuilding('2');

        expect(building.modeSwitch).toEqual({ kind: 'possible', costCpu: '2' });
        expect(building).toHaveProperty('modeSwitchCost', '2');
    });
});

describe('AppConfigService randomness descriptor', () => {
    async function loadRandomness(randomness: unknown): Promise<AppConfig['randomness']> {
        const base = makeResponse();
        const data: Record<string, unknown> = { ...base, randomness };
        if (randomness === undefined) {
            delete data.randomness;
        }
        const config = await makeService(new FakeApi({ status: 200, data })).load();
        return config.randomness;
    }

    it('parses a push descriptor and keeps the adapter address the stand has not deployed yet', async () => {
        expect(await loadRandomness({ kind: 'entropy', adapter: '' })).toEqual({ kind: 'entropy', adapter: '' });
    });

    it('parses a push descriptor carrying a deployed adapter address', async () => {
        expect(await loadRandomness({ kind: 'entropy', adapter: ADAPTER })).toEqual({
            kind: 'entropy',
            adapter: ADAPTER,
        });
    });

    it('parses a self-service descriptor with its beacon params', async () => {
        expect(
            await loadRandomness({
                kind: 'drand',
                adapter: ADAPTER,
                genesis: 1_700_000_000,
                period: 30,
                beaconApi: 'https://beacon.example/v2',
            }),
        ).toEqual({
            kind: 'drand',
            adapter: ADAPTER,
            genesis: 1_700_000_000,
            period: 30,
            beaconApi: 'https://beacon.example/v2',
        });
    });

    it('drops the beacon params a push descriptor has no business carrying', async () => {
        const parsed = await loadRandomness({ kind: 'entropy', adapter: ADAPTER, beaconApi: 'https://beacon.example' });

        expect(parsed).toEqual({ kind: 'entropy', adapter: ADAPTER });
        expect('beaconApi' in parsed).toBe(false);
    });

    it('rejects a config that serves no descriptor as older than the client', async () => {
        await expect(loadRandomness(undefined)).rejects.toThrow(/older than the client/i);
        await expect(loadRandomness(undefined)).rejects.toThrow(/no randomness descriptor/i);
    });

    it('rejects a null descriptor the same way as a missing one', async () => {
        await expect(loadRandomness(null)).rejects.toThrow(/older than the client/i);
    });

    it('rejects a kind this client cannot drive, naming the kinds it knows', async () => {
        await expect(loadRandomness({ kind: 'oracle', adapter: ADAPTER })).rejects.toThrow(
            /randomness kind "oracle".*older than the client.*known kinds: entropy, drand/is,
        );
    });

    it('rejects a descriptor whose kind is missing altogether', async () => {
        await expect(loadRandomness({ adapter: ADAPTER })).rejects.toThrow(/older than the client/i);
    });

    it('rejects a self-service descriptor missing its beacon params, naming the rejected fields', async () => {
        await expect(loadRandomness({ kind: 'drand', adapter: ADAPTER, genesis: 1, period: 2 })).rejects.toThrow(
            /incomplete "drand" randomness descriptor.*older than the client.*beaconApi/is,
        );
    });
});

describe('AppConfigService', () => {
    it('loads config for the configured network and caches it', async () => {
        const api = new FakeApi({ status: 200, data: makeResponse() });
        const service = makeService(api);

        const first = await service.load();
        const second = await service.load();

        expect(api.paths).toEqual(['/api/v1/config?network=robinhood']);
        expect(first.chainId).toBe(4663);
        expect(first.network).toBe(Network.ROBINHOOD);
        expect(first.contracts.cell).toBe(CELL);
        expect(first.contracts.weth).toBe(WETH);
        expect(first.contracts.usdg).toBe(USDG);
        expect(first.contracts.cpuHook).toBe(CPU_HOOK);
        expect(first.resources[5]).toBe('Iron');
        expect(first.transport.moveFeeFloors).toEqual({ 5: '0.1' });
        expect(first.trade).toEqual({ saleBurnPercent: 1, maxSaleFeePercent: 50 });
        expect(first.storage).toEqual({ caps: [{ resourceId: 1, cellCap: 100, hubCap: 1000 }] });
        expect(second).toBe(first);
    });

    it('carries the syndicate registry address through when configured', async () => {
        const config = await makeService(new FakeApi({ status: 200, data: makeResponse() })).load();
        expect(config.contracts.syndicate).toBe('0x9999999999999999999999999999999999999999');
    });

    it('normalizes a missing syndicate address to null', async () => {
        const base = makeResponse();
        const { syndicate: _dropped, ...contracts } = base.contracts;
        const data = { ...base, contracts };
        const config = await makeService(new FakeApi({ status: 200, data })).load();
        expect(config.contracts.syndicate).toBeNull();
    });

    it('normalizes the zero syndicate address to null', async () => {
        const config = await makeService(
            new FakeApi({
                status: 200,
                data: makeResponse({
                    contracts: {
                        ...makeResponse().contracts,
                        syndicate: '0x0000000000000000000000000000000000000000',
                    },
                }),
            }),
        ).load();
        expect(config.contracts.syndicate).toBeNull();
    });

    it('rejects a config that carries no trade block instead of reporting a zero burn', async () => {
        const { trade: _dropped, ...rest } = makeResponse();

        await expect(makeService(new FakeApi({ status: 200, data: rest })).load()).rejects.toThrow(/trade/i);
    });

    it('rejects a trade block with no sale burn rather than defaulting it to zero', async () => {
        const data = makeResponse({ trade: { maxSaleFeeBp: 5000 } as AppConfigFixture['trade'] });

        await expect(makeService(new FakeApi({ status: 200, data })).load()).rejects.toThrow(/saleBurnPercent/);
    });

    it('rejects a trade block with no sale-fee ceiling rather than defaulting it to zero', async () => {
        const data = makeResponse({ trade: { saleBurnPercent: 1 } as AppConfigFixture['trade'] });

        await expect(makeService(new FakeApi({ status: 200, data })).load()).rejects.toThrow(/maxSaleFeeBp/);
    });

    it('surfaces the per-resource transit-fee floors verbatim', async () => {
        const floors = { 1: '0', 5: '0.25', 100: '2', 113: '3.5' };
        const loaded = await makeService(
            new FakeApi({
                status: 200,
                data: makeResponse({
                    transport: { moveRadius: 1, hubRadius: 3, moveTimePerCellSec: 2, moveFeeFloors: floors },
                }),
            }),
        ).load();
        expect(loaded.transport.moveFeeFloors).toEqual(floors);
    });

    it('fails loudly when a legacy config carries no per-resource transit-fee floors', async () => {
        const { transport: _dropped, ...rest } = makeResponse();
        const legacy = { ...rest, transport: { moveRadius: 1, hubRadius: 3, moveTimePerCellSec: 2 } };
        await expect(makeService(new FakeApi({ status: 200, data: legacy })).load()).rejects.toThrow();
    });

    it('rejects an empty floor map rather than normalising it to an empty record', async () => {
        const empty = makeResponse({
            transport: { moveRadius: 1, hubRadius: 3, moveTimePerCellSec: 2, moveFeeFloors: {} },
        });
        await expect(makeService(new FakeApi({ status: 200, data: empty })).load()).rejects.toThrow();
    });

    it('passes recipes through and defaults them to an empty array when absent', async () => {
        const recipe = {
            id: CraftRecipeId.SmeltSteel,
            name: 'Smelt Steel',
            tier: 2,
            inputs: [{ resourceId: 5, amount: 4 }],
            outputs: [{ resourceId: 102, amount: 2 }],
            durationSec: 30,
            costCpu: '0',
        };
        const withRecipes = await makeService(
            new FakeApi({ status: 200, data: makeResponse({ recipes: [recipe] }) }),
        ).load();
        expect(withRecipes.recipes).toEqual([recipe]);

        // Addresses may be empty before contracts deploy; config load no longer rejects that.
        const without = await makeService(
            new FakeApi({
                status: 200,
                data: {
                    network: 'robinhood',
                    chainId: 4663,
                    contracts: { land: '', cpuToken: '', cpuHook: '', cell: '' },
                    randomness: { kind: RandomnessKind.ENTROPY, adapter: '' },
                    resources: {},
                    transport: { moveRadius: 1, hubRadius: 3, moveTimePerCellSec: 2, moveFeeFloors: { 5: '0' } },
                    trade: { saleBurnPercent: 0, maxSaleFeeBp: 0 },
                    storage: { caps: [{ resourceId: 1, cellCap: 100, hubCap: 1000 }] },
                },
            }),
        ).load();
        expect(without.recipes).toEqual([]);
        expect(without.buildings).toEqual([]);
        expect(without.reveal).toBeNull();
    });

    it('reports an unknown reveal payment, never a free one, when the API serves a shape it cannot price', async () => {
        const api = new FakeApi({
            status: 200,
            data: makeResponse({ reveal: { firstFree: true, reRevealCost: '1000' } as never }),
        });

        expect((await makeService(api).load()).reveal).toBeNull();
    });

    it('reads the fractional reveal budget and burn the game API serves', async () => {
        const api = new FakeApi({
            status: 200,
            data: makeResponse({ reveal: { ethBudget: '0.0001', cpuBurn: '1' } }),
        });

        expect((await makeService(api).load()).reveal).toEqual({ ethBudget: '0.0001', cpuBurn: '1' });
    });

    it('keeps both reveal values as served, including a zero budget', async () => {
        const api = new FakeApi({
            status: 200,
            data: makeResponse({ reveal: { ethBudget: '0', cpuBurn: '7' } }),
        });

        expect((await makeService(api).load()).reveal).toEqual({ ethBudget: '0', cpuBurn: '7' });
    });

    it('does not silently reinterpret the retired contribution field as the whole reveal budget', async () => {
        const api = new FakeApi({
            status: 200,
            data: makeResponse({ reveal: { ethContribution: '0.0001', cpuBurn: '1' } }),
        });

        expect((await makeService(api).load()).reveal).toBeNull();
    });

    it('throws on a non-200 config response', async () => {
        const api = new FakeApi({ status: 500, data: {} });
        await expect(makeService(api).load()).rejects.toThrow(/Failed to load chain config/i);
    });

    it('has no client-side default for storage shelves and fails loudly when the API omits them', async () => {
        const { storage: _storage, ...withoutStorage } = makeResponse();
        const api = new FakeApi({ status: 200, data: withoutStorage });
        await expect(makeService(api).load()).rejects.toThrow();
    });

    it('rejects the retired storage multiplier shape', async () => {
        const stale = { ...makeResponse(), storage: { hubStorageMultiplier: 10 } };
        await expect(makeService(new FakeApi({ status: 200, data: stale })).load()).rejects.toThrow();
    });

    it('rejects duplicate or unsorted storage cap rows', async () => {
        const duplicate = makeResponse({
            storage: {
                caps: [
                    { resourceId: 5, cellCap: 100, hubCap: 1000 },
                    { resourceId: 5, cellCap: 200, hubCap: 2000 },
                ],
            },
        });
        const unsorted = makeResponse({
            storage: {
                caps: [
                    { resourceId: 6, cellCap: 100, hubCap: 1000 },
                    { resourceId: 5, cellCap: 200, hubCap: 2000 },
                ],
            },
        });

        await expect(makeService(new FakeApi({ status: 200, data: duplicate })).load()).rejects.toThrow(
            /strictly ascending/i,
        );
        await expect(makeService(new FakeApi({ status: 200, data: unsorted })).load()).rejects.toThrow(
            /strictly ascending/i,
        );
    });

    it('preserves zero storage shelves as the config representation of unlimited', async () => {
        const config = await makeService(
            new FakeApi({
                status: 200,
                data: makeResponse({ storage: { caps: [{ resourceId: 1, cellCap: 0, hubCap: 0 }] } }),
            }),
        ).load();

        expect(config.storage.caps).toEqual([{ resourceId: 1, cellCap: 0, hubCap: 0 }]);
    });

    it('rejects negative storage shelf capacities', async () => {
        const negativeCell = makeResponse({
            storage: { caps: [{ resourceId: 1, cellCap: -1, hubCap: 1000 }] },
        });
        const negativeHub = makeResponse({
            storage: { caps: [{ resourceId: 1, cellCap: 100, hubCap: -1 }] },
        });

        await expect(makeService(new FakeApi({ status: 200, data: negativeCell })).load()).rejects.toThrow();
        await expect(makeService(new FakeApi({ status: 200, data: negativeHub })).load()).rejects.toThrow();
    });

    it('rejects a config that identifies a different network or chain', async () => {
        await expect(
            makeService(new FakeApi({ status: 200, data: { ...makeResponse(), network: 'ethereum' } })).load(),
        ).rejects.toThrow();
        await expect(
            makeService(new FakeApi({ status: 200, data: { ...makeResponse(), chainId: 1 } })).load(),
        ).rejects.toThrow();
    });

    it('rejects a pre-rename config whose building effects lack the required extraction share', async () => {
        const base = makeResponse();
        const [mine] = base.buildings;
        const { effects, ...rest } = mine as BuildingView;
        const { extractionShareBp: _dropped, ...preRenameEffects } = effects;
        const stale = { ...rest, effects: preRenameEffects };
        const api = new FakeApi({ status: 200, data: { ...base, buildings: [stale] } });
        await expect(makeService(api).load()).rejects.toThrow();
    });

    it('accepts recipeOpexCpu as a served map and normalises its absence to null', async () => {
        const base = makeResponse();
        const [mine] = base.buildings;
        const served = { ...(mine as BuildingView), recipeOpexCpu: { smelt_steel: '0.5' } };
        const withMap = await makeService(new FakeApi({ status: 200, data: { ...base, buildings: [served] } })).load();
        expect(withMap.buildings[0]?.recipeOpexCpu).toEqual({ smelt_steel: '0.5' });

        const { recipeOpexCpu: _drop, ...withoutOpex } = mine as BuildingView;
        const withNull = await makeService(
            new FakeApi({ status: 200, data: { ...base, buildings: [withoutOpex] } }),
        ).load();
        expect(withNull.buildings[0]?.recipeOpexCpu).toBeNull();
    });

    it('carries a served upgrade graph entry through untouched', async () => {
        const base = makeResponse();
        const [mine] = base.buildings;
        const served = {
            ...(mine as BuildingView),
            upgradeTo: ['mine_branch_a_l2', 'mine_branch_b_l2'],
            family: 'mine',
            level: 1,
            branch: null,
        };
        const config = await makeService(new FakeApi({ status: 200, data: { ...base, buildings: [served] } })).load();
        expect(config.buildings[0]?.upgradeTo).toEqual(['mine_branch_a_l2', 'mine_branch_b_l2']);
        expect(config.buildings[0]?.family).toBe('mine');
        expect(config.buildings[0]?.level).toBe(1);
        expect(config.buildings[0]?.branch).toBeNull();
    });

    it('accepts dynamic upgrade types that are not part of the base building enum', async () => {
        const base = makeResponse();
        const [mine] = base.buildings;
        const upgraded = {
            ...(mine as BuildingView),
            type: 'mine_l2a',
            onChainId: 46,
            upgradeFrom: BuildingType.Mine,
        };

        const config = await makeService(
            new FakeApi({ status: 200, data: { ...base, buildings: [...base.buildings, upgraded] } }),
        ).load();

        expect(config.buildings.at(-1)?.type).toBe('mine_l2a');
        expect(config.buildings.at(-1)?.upgradeFrom).toBe(BuildingType.Mine);
    });

    it('defaults a catalog entry from an API that predates the upgrade graph to no upgrade participation', async () => {
        const base = makeResponse();
        const [mine] = base.buildings;
        const {
            upgradeTo: _upgradeTo,
            family: _family,
            level: _level,
            branch: _branch,
            ...legacy
        } = mine as BuildingView;
        const config = await makeService(new FakeApi({ status: 200, data: { ...base, buildings: [legacy] } })).load();
        expect(config.buildings[0]?.upgradeTo).toEqual([]);
        expect(config.buildings[0]?.family).toBeNull();
        expect(config.buildings[0]?.level).toBeNull();
        expect(config.buildings[0]?.branch).toBeNull();
    });
});

describe('AppConfigService load() racing a concurrent replace()', () => {
    it('keeps the config a replace() installed while a cold load() was still awaiting its own fetch', async () => {
        let resolveFetch: (response: { status: number; data: unknown }) => void = () => {
            throw new Error('request() was never called');
        };
        const hangingApi = {
            paths: [] as Array<string>,
            request: (path: string) => {
                hangingApi.paths.push(path);
                return new Promise<{ status: number; data: unknown }>((resolve) => {
                    resolveFetch = resolve;
                });
            },
        } as unknown as FakeApi;
        const service = makeService(hangingApi);

        const pending = service.load();

        const freshConfig = await makeService(new FakeApi({ status: 200, data: makeResponse() })).load();
        service.replace(freshConfig);

        resolveFetch({ status: 200, data: makeResponse() });

        expect(await pending).toBe(freshConfig);
        expect(await service.load()).toBe(freshConfig);
    });
});

describe('AppConfigService building radius', () => {
    function servedWith(row: Record<string, unknown>): AppConfigFixture {
        const base = makeResponse();
        const [mine] = base.buildings;
        return { ...base, buildings: [{ ...(mine as BuildingView), ...row }] } as AppConfigFixture;
    }

    async function loadServed(row: Record<string, unknown>): Promise<AppConfig> {
        return makeService(new FakeApi({ status: 200, data: servedWith(row) })).load();
    }

    it('reads the routing radius the catalog serves for each building', async () => {
        const config = await loadServed({ kind: BuildingKind.Hub, radius: 5 });

        expect(config.buildings[0]?.radius).toBe(5);
    });

    it('keeps the served radius of every hub tier apart instead of collapsing them into one reach', async () => {
        const base = makeResponse();
        const [mine] = base.buildings;
        const ladder = [
            { type: BuildingType.Hub, onChainId: 23, kind: BuildingKind.Hub, radius: 5 },
            { type: 'hub_l2a', onChainId: 96, kind: BuildingKind.Hub, radius: 8 },
            { type: 'hub_l3a', onChainId: 97, kind: BuildingKind.Hub, radius: 13 },
        ].map((row) => ({ ...(mine as BuildingView), ...row }));

        const config = await makeService(new FakeApi({ status: 200, data: { ...base, buildings: ladder } })).load();

        expect(config.buildings.map((b) => b.radius)).toEqual([5, 8, 13]);
    });

    it('preserves a zero radius on a building that does not route', async () => {
        const config = await loadServed({ radius: 0 });

        expect(config.buildings[0]?.radius).toBe(0);
    });

    it('fails loudly when a catalog row serves no radius at all instead of defaulting one', async () => {
        const base = makeResponse();
        const [mine] = base.buildings;
        const { radius: _dropped, ...withoutRadius } = mine as BuildingView;

        await expect(
            makeService(new FakeApi({ status: 200, data: { ...base, buildings: [withoutRadius] } })).load(),
        ).rejects.toThrow(/radius/i);
    });

    it('rejects a malformed radius rather than falling back to a default reach', async () => {
        await expect(loadServed({ radius: '5' })).rejects.toThrow(/radius/i);
        await expect(loadServed({ radius: 2.5 })).rejects.toThrow(/radius/i);
        await expect(loadServed({ radius: -1 })).rejects.toThrow(/radius/i);
        await expect(loadServed({ radius: null })).rejects.toThrow(/radius/i);
    });
});
