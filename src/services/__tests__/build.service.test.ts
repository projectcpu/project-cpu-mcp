import {
    decodeFunctionData,
    encodeAbiParameters,
    encodeErrorResult,
    encodeEventTopics,
    parseEther,
    type Abi,
    type Address,
    type Hash,
    type Hex,
    type Log,
} from 'viem';
import { describe, expect, it } from 'vitest';

import { BuildingType } from '../../api/types.js';
import { CELL_ABI } from '../../contracts/cell.abi.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { makeCell, makeResource, makeStorage } from '../../map/__tests__/fixtures.js';
import { toCell } from '../../map/cell-view.utils.js';
import { toProjectionConfig } from '../../map/reader.utils.js';
import { CellProcessKind, type Cell, type RawCell, type RevealCellReader } from '../../map/types.js';
import { ContractClient } from '../../wallet/contract-client.js';
import { TxStatus, type WalletProvider } from '../../wallet/types.js';
import { BuildService } from '../build.service.js';
import { CellClient } from '../cell.client.js';
import { UpgradeRevertName, type AppConfig, type BuildInput, type CatalogBuildingView } from '../types.js';
import {
    APPROVE_HASH,
    CELL,
    CPU_TOKEN,
    DEFAULT_SERVER_TIME,
    FakeAllowance,
    FakeAppConfig,
    type FakeContractClient,
    FakeMapReader,
    FakeWallet,
    makeCellHarness,
    makeConfig,
    WALLET_ADDRESS,
} from './service-fakes.js';

const EXTRACTOR: BuildInput = { tokenId: '42', buildingType: BuildingType.Mine };

const LOG_META = {
    blockHash: `0x${'0'.repeat(64)}`,
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: `0x${'0'.repeat(64)}`,
    transactionIndex: 0,
    removed: false,
} as const;

function demolishedLog(finishAt: bigint, buildingTypeId = 4): Log {
    const topics = encodeEventTopics({ abi: CELL_ABI, eventName: 'BuildingDemolished', args: { tokenId: 42n } });
    const data = encodeAbiParameters(
        [{ type: 'uint16' }, { type: 'uint64' }, { type: 'uint16[]' }, { type: 'uint64[]' }],
        [buildingTypeId, finishAt, [], []],
    );
    return { address: CELL as Address, topics, data, ...LOG_META } as unknown as Log;
}

function placedLog(finishAt: bigint, buildingTypeId = 46): Log {
    const topics = encodeEventTopics({ abi: CELL_ABI, eventName: 'BuildingPlaced', args: { tokenId: 42n } });
    const data = encodeAbiParameters(
        [{ type: 'uint16' }, { type: 'uint64' }, { type: 'uint16[]' }, { type: 'uint64[]' }],
        [buildingTypeId, finishAt, [], []],
    );
    return { address: CELL as Address, topics, data, ...LOG_META } as unknown as Log;
}

function makeService(opts: Parameters<typeof makeCellHarness>[1] = {}) {
    return makeCellHarness((deps) => new BuildService(deps), opts);
}

function decodeSent(
    contracts: FakeContractClient,
    index: number,
): { functionName: string; args: ReadonlyArray<unknown> } {
    const tx = contracts.sent[index];
    if (tx === undefined) {
        throw new Error(`expected a tx at index ${index}`);
    }
    return decodeFunctionData({ abi: CELL_ABI, data: tx.data as Hex });
}

describe('BuildService', () => {
    it('approves $CPU to the Cell and places the extractor (no mining — that is a separate step)', async () => {
        const { service, contracts, allowance } = makeService({ approve: APPROVE_HASH });

        const result = await service.build(EXTRACTOR);

        expect(allowance.calls).toEqual([{ token: CPU_TOKEN, spender: CELL, needed: parseEther('5') }]);
        expect(contracts.sent).toHaveLength(1);
        expect(contracts.sent[0]?.to).toBe(CELL);

        const place = decodeSent(contracts, 0);
        expect(place.functionName).toBe('place');
        expect(place.args).toEqual([42n, 4]);

        expect(result.approveTxHash).toBe(APPROVE_HASH);
        expect(result.buildTxHash).not.toBeNull();
        expect(result.alreadyBuilt).toBe(false);
        expect(result.buildCost).toBe('5');
    });

    it('encodes the on-chain id from config — a hub places as id 23', async () => {
        const { service, contracts, allowance } = makeService();

        await service.build({ tokenId: '42', buildingType: BuildingType.Hub });

        expect(allowance.calls[0]?.needed).toBe(parseEther('40'));
        expect(contracts.sent).toHaveLength(1);
        const place = decodeSent(contracts, 0);
        expect(place.functionName).toBe('place');
        expect(place.args).toEqual([42n, 23]);
    });

    it('is a no-op when the building is already in place (safe to retry an interrupted build)', async () => {
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: null, modeRecipeId: null },
        });
        const { service, contracts, allowance } = makeService({ cell });

        const result = await service.build(EXTRACTOR);

        expect(allowance.calls).toHaveLength(0);
        expect(contracts.sent).toHaveLength(0);
        expect(result.alreadyBuilt).toBe(true);
        expect(result.buildTxHash).toBeNull();
        expect(result.buildCost).toBe('0');
    });

    it('rejects switching an occupied cell to a different building type — only cpu_upgrade replaces an installed building', async () => {
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: null, modeRecipeId: null },
        });
        const { service, contracts, allowance } = makeService({ cell });

        await expect(service.build({ tokenId: '42', buildingType: BuildingType.SteelMill })).rejects.toThrow(
            /already has a mine; demolish it before building a steel_mill/i,
        );
        expect(contracts.sent).toHaveLength(0);
        expect(allowance.calls).toHaveLength(0);
    });

    it('reports no approve tx when the allowance already covered the cost', async () => {
        const { service, allowance } = makeService({ approve: null });
        const result = await service.build(EXTRACTOR);
        expect(allowance.calls).toHaveLength(1);
        expect(result.approveTxHash).toBeNull();
    });

    it('refuses when $CPU is not configured', async () => {
        const { service, contracts, allowance } = makeService({ config: makeConfig('') });
        await expect(service.build(EXTRACTOR)).rejects.toThrow(/not configured.*cannot pay for build/i);
        expect(contracts.sent).toHaveLength(0);
        expect(allowance.calls).toHaveLength(0);
    });

    it('rejects a build on a cell owned by someone else', async () => {
        const cell = makeCell({ tokenId: '42', owner: '0xother' });
        const { service, contracts } = makeService({ cell });
        await expect(service.build(EXTRACTOR)).rejects.toThrow(/do not own/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('rejects a build while a process is active', async () => {
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            process: {
                kind: CellProcessKind.Mining,
                resource: 5,
                durationSec: 180,
                yieldPerCycle: 77,
                batches: 10,
                claimedBatches: 0,
                startAt: 1,
            },
        });
        const { service, contracts } = makeService({ cell });
        await expect(service.build(EXTRACTOR)).rejects.toThrow(/active .*process/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('rejects a build when the warehouse lacks the refined build inputs', async () => {
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            resources: [makeResource({ resourceId: 101, balance: '3' })],
        });
        const { service, contracts, allowance } = makeService({ cell });
        await expect(service.build({ tokenId: '42', buildingType: BuildingType.SteelMill })).rejects.toThrow(
            /needs 8 Concrete/i,
        );
        expect(contracts.sent).toHaveLength(0);
        expect(allowance.calls).toHaveLength(0);
    });

    it('wraps an on-chain revert of the place', async () => {
        const { service } = makeService({ receipts: [TxStatus.Reverted] });
        await expect(service.build(EXTRACTOR)).rejects.toThrow(/build transaction reverted/i);
    });

    it('refuses when the wallet chainId does not match the chain config', async () => {
        const { service, contracts } = makeService({ walletChainId: 8453 });
        await expect(service.build(EXTRACTOR)).rejects.toThrow(/chain mismatch/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('approves the burned $CPU and demolishes, reporting the unlock time from the event', async () => {
        const finishAt = BigInt(DEFAULT_SERVER_TIME + 200);
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: null, modeRecipeId: null },
        });
        const { service, contracts, allowance } = makeService({
            cell,
            approve: APPROVE_HASH,
            logs: [[demolishedLog(finishAt)]],
        });

        const result = await service.demolish({ tokenId: '42' });

        expect(allowance.calls).toEqual([{ token: CPU_TOKEN, spender: CELL, needed: parseEther('2.5') }]);
        expect(contracts.sent).toHaveLength(1);
        expect(decodeSent(contracts, 0).functionName).toBe('demolish');
        expect(result.approveTxHash).toBe(APPROVE_HASH);
        expect(result.buildingType).toBe(BuildingType.Mine);
        expect(result.cpuBurned).toBe('2.5');
        expect(result.rebuildUnlockAt).toBe(DEFAULT_SERVER_TIME + 200);
        expect(result.rebuildCooldownSec).toBe(200);
        expect(result.status).toBe(TxStatus.Success);
        expect(result.blockNumber).toBe('100');
    });

    it('demolishes an upgraded building by pricing its type off the catalog', async () => {
        const base = makeConfig();
        const mine = base.buildings.find((b) => b.type === BuildingType.Mine) as CatalogBuildingView;
        const config = {
            ...base,
            buildings: [
                ...base.buildings,
                { ...mine, type: 'mine_l2a' as CatalogBuildingView['type'], onChainId: 46, name: 'Mine L2A' },
            ],
        };
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            building: { type: 'mine_l2a', buildFinishAt: null, modeResource: null, modeRecipeId: null },
        });
        const { service, contracts } = makeService({
            cell,
            config,
            approve: APPROVE_HASH,
            logs: [[demolishedLog(BigInt(DEFAULT_SERVER_TIME + 100))]],
        });

        const result = await service.demolish({ tokenId: '42' });

        expect(decodeSent(contracts, 0).functionName).toBe('demolish');
        expect(result.buildingType).toBe('mine_l2a');
        expect(result.cpuBurned).toBe('2.5');
    });

    it('reports the event finish time even when it differs from the demolished type own build time', async () => {
        const finishAt = BigInt(DEFAULT_SERVER_TIME + 500);
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            building: { type: BuildingType.SteelMill, buildFinishAt: null, modeResource: null, modeRecipeId: null },
            resources: [makeResource({ resourceId: 101, balance: '2' })],
        });
        const { service } = makeService({ cell, logs: [[demolishedLog(finishAt, 11)]] });

        const result = await service.demolish({ tokenId: '42' });

        expect(result.rebuildUnlockAt).toBe(DEFAULT_SERVER_TIME + 500);
        expect(result.rebuildCooldownSec).toBe(500);
        expect(result.rebuildCooldownSec).not.toBe(900);
    });

    it('degrades gracefully when the receipt is missing the demolish event', async () => {
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: null, modeRecipeId: null },
        });
        const { service, contracts } = makeService({ cell });

        const result = await service.demolish({ tokenId: '42' });

        expect(contracts.sent).toHaveLength(1);
        expect(result.rebuildUnlockAt).toBeNull();
        expect(result.rebuildCooldownSec).toBeNull();
        expect(result.status).toBe(TxStatus.Success);
    });

    it('refuses to demolish an empty cell (nothing to tear down)', async () => {
        const cell = makeCell({ tokenId: '42', owner: WALLET_ADDRESS });
        const { service, contracts, allowance } = makeService({ cell });
        await expect(service.demolish({ tokenId: '42' })).rejects.toThrow(/no building to demolish/i);
        expect(contracts.sent).toHaveLength(0);
        expect(allowance.calls).toHaveLength(0);
    });

    it('uses a demolish-specific error when $CPU is not configured', async () => {
        const cell = occupiedCell();
        const { service, contracts, allowance } = makeService({ cell, config: makeConfig('') });

        await expect(service.demolish({ tokenId: '42' })).rejects.toThrow(/not configured.*cannot pay for demolish/i);
        expect(contracts.sent).toHaveLength(0);
        expect(allowance.calls).toHaveLength(0);
    });

    it('refuses to demolish while a process is active', async () => {
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: null, modeRecipeId: null },
            process: {
                kind: CellProcessKind.Mining,
                resource: 5,
                durationSec: 180,
                yieldPerCycle: 77,
                batches: 10,
                claimedBatches: 0,
                startAt: 1,
            },
        });
        const { service, contracts } = makeService({ cell });
        await expect(service.demolish({ tokenId: '42' })).rejects.toThrow(/active .*process/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('refuses to demolish when the warehouse lacks the consumed inputs', async () => {
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            building: { type: BuildingType.SteelMill, buildFinishAt: null, modeResource: null, modeRecipeId: null },
            resources: [makeResource({ resourceId: 101, balance: '1' })],
        });
        const { service, contracts } = makeService({ cell });
        await expect(service.demolish({ tokenId: '42' })).rejects.toThrow(/needs 2 Concrete/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('refuses to demolish a hub that still anchors open trade lots', async () => {
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            building: { type: BuildingType.Hub, buildFinishAt: null, modeResource: null, modeRecipeId: null },
            resources: [
                makeResource({
                    resourceId: 5,
                    storage: makeStorage({ reserved: { incomingTransport: '0', lots: '10' } }),
                }),
            ],
        });
        const { service, contracts, allowance } = makeService({ cell });
        await expect(service.demolish({ tokenId: '42' })).rejects.toThrow(/anchors open trade lots/i);
        expect(contracts.sent).toHaveLength(0);
        expect(allowance.calls).toHaveLength(0);
    });

    it('blocks a rebuild while the cell is in demolition cooldown', async () => {
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            building: null,
            demolishFinishAt: DEFAULT_SERVER_TIME + 1000,
        });
        const { service, contracts } = makeService({ cell });
        await expect(service.build(EXTRACTOR)).rejects.toThrow(/demolition cooldown/i);
        expect(contracts.sent).toHaveLength(0);
    });
});

function upgradeConfig(overrides: Partial<CatalogBuildingView> = {}) {
    const base = makeConfig();
    const mine = base.buildings.find((b) => b.type === BuildingType.Mine) as CatalogBuildingView;
    const target = {
        ...mine,
        type: 'mine_l2a' as CatalogBuildingView['type'],
        onChainId: 46,
        name: 'Mine L2A',
        buildCost: '15',
        buildInputs: [{ resourceId: 101, amount: 3 }],
        upgradeFrom: BuildingType.Mine,
        ...overrides,
    } as CatalogBuildingView;
    return { ...base, buildings: [...base.buildings, target] };
}

function occupiedCell(overrides: Partial<Parameters<typeof makeCell>[0]> = {}) {
    return makeCell({
        tokenId: '42',
        owner: WALLET_ADDRESS,
        building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: null, modeRecipeId: null },
        ...overrides,
    });
}

describe('BuildService upgrade', () => {
    it('accepts a dynamic target absent from the static enum, approves its cost, and places its on-chain id', async () => {
        const config = upgradeConfig();
        const finishAt = BigInt(DEFAULT_SERVER_TIME + 900);
        const { service, contracts, allowance } = makeService({
            cell: occupiedCell(),
            config,
            approve: APPROVE_HASH,
            logs: [[placedLog(finishAt)]],
        });

        const result = await service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' });

        expect(allowance.calls).toEqual([{ token: CPU_TOKEN, spender: CELL, needed: parseEther('15') }]);
        const place = decodeSent(contracts, 0);
        expect(place.functionName).toBe('place');
        expect(place.args).toEqual([42n, 46]);

        expect(result.fromBuildingType).toBe(BuildingType.Mine);
        expect(result.toBuildingType).toBe('mine_l2a');
        expect(result.buildCost).toBe('15');
        expect(result.buildInputs).toEqual([{ resourceId: 101, amount: 3 }]);
        expect(result.upgrading).toBe(true);
        expect(result.finishAt).toBe(DEFAULT_SERVER_TIME + 900);
        expect(result.approveTxHash).toBe(APPROVE_HASH);
        expect(result.status).toBe(TxStatus.Success);
    });

    it('degrades to a null finish time when the receipt is missing the placement event, staying successful', async () => {
        const config = upgradeConfig();
        const { service, contracts } = makeService({ cell: occupiedCell(), config });

        const result = await service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' });

        expect(contracts.sent).toHaveLength(1);
        expect(result.finishAt).toBeNull();
        expect(result.status).toBe(TxStatus.Success);
    });

    it('rejects a target absent from the catalog before approval or placement', async () => {
        const config = upgradeConfig();
        const { service, contracts, allowance } = makeService({ cell: occupiedCell(), config });

        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'nonexistent_building' })).rejects.toThrow(
            /no catalog entry/i,
        );
        expect(contracts.sent).toHaveLength(0);
        expect(allowance.calls).toHaveLength(0);
    });

    it('rejects a catalog target with no predecessor as a base building that belongs to cpu_build', async () => {
        const config = upgradeConfig();
        const { service, contracts, allowance } = makeService({ cell: occupiedCell(), config });

        await expect(service.upgrade({ tokenId: '42', targetBuildingType: BuildingType.SteelMill })).rejects.toThrow(
            /base building.*cpu_build/i,
        );
        expect(contracts.sent).toHaveLength(0);
        expect(allowance.calls).toHaveLength(0);
    });

    it('rejects a missing cell', async () => {
        const config = upgradeConfig();
        const { service, contracts } = makeService({ config });

        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /not found on the map/i,
        );
        expect(contracts.sent).toHaveLength(0);
    });

    it('rejects an empty cell', async () => {
        const config = upgradeConfig();
        const cell = makeCell({ tokenId: '42', owner: WALLET_ADDRESS });
        const { service, contracts } = makeService({ cell, config });

        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /has no building/i,
        );
        expect(contracts.sent).toHaveLength(0);
    });

    it('rejects a cell owned by someone else', async () => {
        const config = upgradeConfig();
        const { service, contracts } = makeService({ cell: occupiedCell({ owner: '0xother' }), config });

        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(/do not own/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('refuses to upgrade when the wallet chainId does not match the chain config, before touching the map', async () => {
        const config = upgradeConfig();
        const { service, contracts, mapReader } = makeService({
            cell: occupiedCell(),
            config,
            walletChainId: 8453,
        });

        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /chain mismatch/i,
        );
        expect(contracts.sent).toHaveLength(0);
        expect(mapReader.refreshed).toBe(0);
    });

    it('refuses to upgrade when $CPU is not configured for the network', async () => {
        const config = { ...upgradeConfig(), contracts: { ...upgradeConfig().contracts, cpuToken: '' } };
        const { service, contracts, allowance } = makeService({ cell: occupiedCell(), config });

        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /not configured.*cannot pay for upgrade/i,
        );
        expect(contracts.sent).toHaveLength(0);
        expect(allowance.calls).toHaveLength(0);
    });

    it('submits without locally enforcing lineage, active-process, cooldown, or capacity — the contract decides', async () => {
        const config = upgradeConfig();
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            building: { type: BuildingType.SteelMill, buildFinishAt: null, modeResource: null, modeRecipeId: null },
            process: {
                kind: CellProcessKind.Mining,
                resource: 5,
                durationSec: 180,
                yieldPerCycle: 77,
                batches: 10,
                claimedBatches: 0,
                startAt: 1,
            },
            demolishFinishAt: DEFAULT_SERVER_TIME + 1000,
        });
        const { service, contracts } = makeService({ cell, config });

        const result = await service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' });

        expect(contracts.sent).toHaveLength(1);
        expect(result.status).toBe(TxStatus.Success);
    });

    it("submits even when the current building has not finished its own construction — readiness is the contract's call", async () => {
        const config = upgradeConfig();
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            building: {
                type: BuildingType.Mine,
                buildFinishAt: DEFAULT_SERVER_TIME + 500,
                modeResource: null,
                modeRecipeId: null,
            },
        });
        const { service, contracts } = makeService({ cell, config });

        const result = await service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' });

        expect(contracts.sent).toHaveLength(1);
        expect(result.status).toBe(TxStatus.Success);
    });

    it("submits even when the warehouse lacks the target's configured build inputs — materials are the contract's call", async () => {
        const config = upgradeConfig();
        const { service, contracts } = makeService({ cell: occupiedCell({ resources: [] }), config });

        const result = await service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' });

        expect(contracts.sent).toHaveLength(1);
        expect(result.status).toBe(TxStatus.Success);
    });
});

describe('BuildService upgrade — no-op idempotency', () => {
    it('returns a transaction-free no-op reporting the building is still upgrading, with its known finish time', async () => {
        const config = upgradeConfig();
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            building: {
                type: 'mine_l2a',
                buildFinishAt: DEFAULT_SERVER_TIME + 300,
                modeResource: null,
                modeRecipeId: null,
            },
        });
        const { service, contracts, allowance } = makeService({ cell, config });

        const result = await service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' });

        expect(contracts.sent).toHaveLength(0);
        expect(allowance.calls).toHaveLength(0);
        expect(result.noop).toBe(true);
        expect(result.upgrading).toBe(true);
        expect(result.finishAt).toBe(DEFAULT_SERVER_TIME + 300);
        expect(result.txHash).toBeNull();
        expect(result.approveTxHash).toBeNull();
        expect(result.buildCost).toBe('0');
        expect(result.buildInputs).toEqual([]);
    });

    it('returns a transaction-free no-op reporting the building is ready, sending neither approval nor placement', async () => {
        const config = upgradeConfig();
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            building: { type: 'mine_l2a', buildFinishAt: null, modeResource: null, modeRecipeId: null },
        });
        const { service, contracts, allowance } = makeService({ cell, config });

        const result = await service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' });

        expect(contracts.sent).toHaveLength(0);
        expect(allowance.calls).toHaveLength(0);
        expect(result.noop).toBe(true);
        expect(result.upgrading).toBe(false);
        expect(result.finishAt).toBeNull();
        expect(result.txHash).toBeNull();
        expect(result.status).toBeNull();
        expect(result.blockNumber).toBeNull();
    });

    it('treats a buildFinishAt exactly equal to the current server time as ready, not still upgrading', async () => {
        const config = upgradeConfig();
        const cell = makeCell({
            tokenId: '42',
            owner: WALLET_ADDRESS,
            building: {
                type: 'mine_l2a',
                buildFinishAt: DEFAULT_SERVER_TIME,
                modeResource: null,
                modeRecipeId: null,
            },
        });
        const { service, contracts } = makeService({ cell, config });

        const result = await service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' });

        expect(contracts.sent).toHaveLength(0);
        expect(result.noop).toBe(true);
        expect(result.upgrading).toBe(false);
        expect(result.finishAt).toBe(DEFAULT_SERVER_TIME);
    });
});

class SequenceMapReader implements RevealCellReader {
    public refreshed = 0;
    private index = 0;
    constructor(
        private readonly cells: ReadonlyArray<Cell | null>,
        private readonly serverTime: number,
    ) {}
    async readRevealCell(): Promise<Cell | null> {
        const cell = this.cells[Math.min(this.index, this.cells.length - 1)] ?? null;
        this.index += 1;
        return cell;
    }
    getServerTime(): number {
        return this.serverTime;
    }
    async refresh(): Promise<void> {
        this.refreshed += 1;
    }
}

function toProjectedCell(config: AppConfig, raw: RawCell): Cell {
    return toCell(raw, DEFAULT_SERVER_TIME, toProjectionConfig(config));
}

function makeFallbackHarness(config: AppConfig, cells: ReadonlyArray<Cell | null>) {
    const wallet = new FakeWallet(1);
    const contracts = new ContractClient({
        wallet: wallet as unknown as WalletProvider,
        logger: new NoopLogger(),
        retry: null,
    });
    const cellClient = new CellClient({ contracts, logger: new NoopLogger() });
    const mapReader = new SequenceMapReader(cells, DEFAULT_SERVER_TIME);
    const service = new BuildService({
        wallet: wallet as unknown as WalletProvider,
        appConfig: new FakeAppConfig(config),
        allowance: new FakeAllowance(APPROVE_HASH),
        cellClient,
        contracts,
        mapReader,
        logger: new NoopLogger(),
    });
    return { service, mapReader };
}

class ThrowingRefreshMapReader implements RevealCellReader {
    public refreshed = 0;
    constructor(
        private readonly cell: Cell | null,
        private readonly serverTime: number,
        private readonly throwsOnCall: number,
    ) {}
    async readRevealCell(): Promise<Cell | null> {
        return this.cell;
    }
    getServerTime(): number {
        return this.serverTime;
    }
    async refresh(): Promise<void> {
        this.refreshed += 1;
        if (this.refreshed === this.throwsOnCall) {
            throw new Error('network blip refreshing the projected state');
        }
    }
}

function makeThrowingRefreshHarness(config: AppConfig, cell: Cell | null, throwsOnCall: number) {
    const wallet = new FakeWallet(1);
    const contracts = new ContractClient({
        wallet: wallet as unknown as WalletProvider,
        logger: new NoopLogger(),
        retry: null,
    });
    const cellClient = new CellClient({ contracts, logger: new NoopLogger() });
    const mapReader = new ThrowingRefreshMapReader(cell, DEFAULT_SERVER_TIME, throwsOnCall);
    const service = new BuildService({
        wallet: wallet as unknown as WalletProvider,
        appConfig: new FakeAppConfig(config),
        allowance: new FakeAllowance(APPROVE_HASH),
        cellClient,
        contracts,
        mapReader,
        logger: new NoopLogger(),
    });
    return { service, mapReader };
}

describe('BuildService upgrade — receipt without a decodable placement event', () => {
    it('recovers the finish time with a best-effort projected-state refresh', async () => {
        const config = upgradeConfig();
        const before = toProjectedCell(config, occupiedCell());
        const after = toProjectedCell(
            config,
            occupiedCell({
                building: {
                    type: 'mine_l2a',
                    buildFinishAt: DEFAULT_SERVER_TIME + 900,
                    modeResource: null,
                    modeRecipeId: null,
                },
            }),
        );
        const { service, mapReader } = makeFallbackHarness(config, [before, after]);

        const result = await service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' });

        expect(mapReader.refreshed).toBe(2);
        expect(result.finishAt).toBe(DEFAULT_SERVER_TIME + 900);
        expect(result.status).toBe(TxStatus.Success);
        expect(result.txHash).not.toBeNull();
    });

    it('stays a successful result when the refreshed projection also carries no finish time', async () => {
        const config = upgradeConfig();
        const before = toProjectedCell(config, occupiedCell());
        const { service } = makeFallbackHarness(config, [before, before]);

        const result = await service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' });

        expect(result.finishAt).toBeNull();
        expect(result.status).toBe(TxStatus.Success);
        expect(result.txHash).not.toBeNull();
    });

    it('stays a successful result even when the best-effort projected-state refresh itself throws', async () => {
        const config = upgradeConfig();
        const cell = toProjectedCell(config, occupiedCell());
        const { service, mapReader } = makeThrowingRefreshHarness(config, cell, 2);

        const result = await service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' });

        expect(mapReader.refreshed).toBe(2);
        expect(result.status).toBe(TxStatus.Success);
        expect(result.finishAt).toBeNull();
        expect(result.txHash).not.toBeNull();
    });
});

function placementRevert(errorName: UpgradeRevertName, args: ReadonlyArray<unknown> = []): Error {
    const data = encodeErrorResult({ abi: CELL_ABI as Abi, errorName, args });
    const error = new Error(`Execution reverted: ${errorName}()`) as Error & { data: Hex };
    error.data = data;
    return error;
}

class ThrowingWallet extends FakeWallet {
    constructor(private readonly error: unknown) {
        super(1);
    }
    async sendTransaction(): Promise<Hash> {
        throw this.error;
    }
}

function revertingHarness(config: AppConfig, error: unknown): { service: BuildService; allowance: FakeAllowance } {
    const wallet = new ThrowingWallet(error);
    const contracts = new ContractClient({
        wallet: wallet as unknown as WalletProvider,
        logger: new NoopLogger(),
        retry: null,
    });
    const cellClient = new CellClient({ contracts, logger: new NoopLogger() });
    const allowance = new FakeAllowance(APPROVE_HASH);
    const mapReader = new FakeMapReader(toProjectedCell(config, occupiedCell()), DEFAULT_SERVER_TIME);
    const service = new BuildService({
        wallet: wallet as unknown as WalletProvider,
        appConfig: new FakeAppConfig(config),
        allowance,
        cellClient,
        contracts,
        mapReader,
        logger: new NoopLogger(),
    });
    return { service, allowance };
}

describe('BuildService upgrade — contract error decoding', () => {
    it('decodes an invalid transition into a clear lineage error', async () => {
        const config = upgradeConfig();
        const { service } = revertingHarness(config, placementRevert(UpgradeRevertName.INVALID_UPGRADE));
        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /not a direct successor/i,
        );
    });

    it('decodes an active process into a clear error without implying an automatic claim or cancel', async () => {
        const config = upgradeConfig();
        const { service } = revertingHarness(config, placementRevert(UpgradeRevertName.PROCESS_ACTIVE));
        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /active mining or crafting process/i,
        );
    });

    it('decodes an unfinished current construction into a distinct readiness error', async () => {
        const config = upgradeConfig();
        const { service } = revertingHarness(config, placementRevert(UpgradeRevertName.BUILDING_NOT_READY));
        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /has not finished its own construction/i,
        );
    });

    it('decodes an active demolition cooldown into a distinct cooldown error', async () => {
        const config = upgradeConfig();
        const { service } = revertingHarness(config, placementRevert(UpgradeRevertName.DEMOLISH_IN_PROGRESS));
        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /demolition cooldown/i,
        );
    });

    it('decodes insufficient upgrade inputs into an actionable resource error', async () => {
        const config = upgradeConfig();
        const { service } = revertingHarness(config, placementRevert(UpgradeRevertName.INSUFFICIENT_LIQUID));
        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /warehouse does not hold/i,
        );
    });

    it('decodes insufficient effective storage capacity into an actionable capacity error naming the resource', async () => {
        const config = upgradeConfig();
        const { service } = revertingHarness(config, placementRevert(UpgradeRevertName.STORAGE_EXCEEDS_CAP, [101]));
        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /Concrete.*storage cap/i,
        );
    });

    it('decodes a storage-cap revert for a resource id the resource catalog does not know into a numbered fallback label', async () => {
        const config = upgradeConfig();
        const { service } = revertingHarness(config, placementRevert(UpgradeRevertName.STORAGE_EXCEEDS_CAP, [999]));
        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /resource #999.*storage cap/i,
        );
    });

    it('leaves a decodable revert whose name is not one of the upgrade errors untouched, rather than mangling it', async () => {
        const config = upgradeConfig();
        const data = encodeErrorResult({ abi: CELL_ABI as Abi, errorName: 'RevealAlreadyPending', args: [] });
        const error = new Error('Execution reverted: RevealAlreadyPending()') as Error & { data: Hex };
        error.data = data;
        const { service } = revertingHarness(config, error);
        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /RevealAlreadyPending/,
        );
    });

    it('decodes a disabled target type into an understandable error', async () => {
        const config = upgradeConfig();
        const { service } = revertingHarness(config, placementRevert(UpgradeRevertName.BUILDING_NOT_ENABLED));
        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /not an enabled building/i,
        );
    });

    it('decodes an on-chain ownership failure into an understandable error', async () => {
        const config = upgradeConfig();
        const { service } = revertingHarness(config, placementRevert(UpgradeRevertName.NOT_CELL_OWNER));
        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(/do not own/i);
    });

    it('decodes an unrevealed cell into a clear reveal-first error', async () => {
        const config = upgradeConfig();
        const { service } = revertingHarness(config, placementRevert(UpgradeRevertName.NOT_REVEALED));
        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /has never been revealed/i,
        );
    });

    it('decodes a base building that vanished on-chain into a re-check error', async () => {
        const config = upgradeConfig();
        const { service } = revertingHarness(config, placementRevert(UpgradeRevertName.NOT_A_BASE_BUILDING));
        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /no longer has a building to upgrade/i,
        );
    });

    it('falls back to a safe general failure for an undecodable revert, without swallowing it', async () => {
        const config = upgradeConfig();
        const { service } = revertingHarness(config, new Error('rpc timeout'));
        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(/rpc timeout/);
    });

    it('never reports success when approval already succeeded but placement then reverted on-chain', async () => {
        const config = upgradeConfig();
        const { service, allowance } = revertingHarness(config, placementRevert(UpgradeRevertName.INVALID_UPGRADE));

        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow();
        expect(allowance.calls).toHaveLength(1);
    });
});

describe('BuildService upgrade — revert on the receipt path', () => {
    it('surfaces a receipt-status revert as the generic confirm failure — only a send-path revert gets decoded', async () => {
        const config = upgradeConfig();
        const { service, contracts, allowance } = makeService({
            cell: occupiedCell(),
            config,
            receipts: [TxStatus.Reverted],
        });

        await expect(service.upgrade({ tokenId: '42', targetBuildingType: 'mine_l2a' })).rejects.toThrow(
            /Upgrade transaction reverted on-chain/i,
        );
        expect(allowance.calls).toHaveLength(1);
        expect(contracts.sent).toHaveLength(1);
    });
});
