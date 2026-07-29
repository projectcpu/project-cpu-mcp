import {
    decodeFunctionData,
    encodeAbiParameters,
    encodeEventTopics,
    parseEther,
    type Address,
    type Hex,
    type Log,
} from 'viem';
import { describe, expect, it } from 'vitest';

import { BuildingType } from '../../api/types.js';
import { CELL_ABI } from '../../contracts/cell.abi.js';
import { makeCell, makeResource, makeStorage } from '../../map/__tests__/fixtures.js';
import { CellProcessKind } from '../../map/types.js';
import { TxStatus } from '../../wallet/types.js';
import { BuildService } from '../build.service.js';
import type { BuildInput, CatalogBuildingView } from '../types.js';
import {
    APPROVE_HASH,
    CELL,
    CPU_TOKEN,
    DEFAULT_SERVER_TIME,
    type FakeContractClient,
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

    it('reports no approve tx when the allowance already covered the cost', async () => {
        const { service, allowance } = makeService({ approve: null });
        const result = await service.build(EXTRACTOR);
        expect(allowance.calls).toHaveLength(1);
        expect(result.approveTxHash).toBeNull();
    });

    it('refuses when $CPU is not configured', async () => {
        const { service, contracts, allowance } = makeService({ config: makeConfig('') });
        await expect(service.build(EXTRACTOR)).rejects.toThrow(/not configured/i);
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
