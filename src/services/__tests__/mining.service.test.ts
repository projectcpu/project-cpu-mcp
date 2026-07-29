import {
    decodeFunctionData,
    encodeAbiParameters,
    encodeEventTopics,
    parseEther,
    type Address,
    type Hex,
    type Log,
} from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { BuildingType } from '../../api/types.js';
import { CELL_ABI } from '../../contracts/cell.abi.js';
import { makeCell, makeMiningProcess, makeResource, makeStorage } from '../../map/__tests__/fixtures.js';
import type { RawCell, RawCellProcessMiningView } from '../../map/types.js';
import { MAX_APPROVE_AMOUNT } from '../allowance.constants.js';
import { MiningService } from '../mining.service.js';
import { type AppConfig, ModeSwitchKind } from '../types.js';
import {
    CELL,
    CPU_TOKEN,
    DEFAULT_SERVER_TIME,
    chainCellView,
    cpuBurnLog,
    makeCellHarness,
    makeConfig,
    WALLET_ADDRESS,
} from './service-fakes.js';

function makeService(opts: Parameters<typeof makeCellHarness>[1] = {}) {
    return makeCellHarness((deps) => new MiningService(deps), opts);
}

function minedLog(resource: number, amount: bigint): Log {
    const topics = encodeEventTopics({ abi: CELL_ABI, eventName: 'ResourceMined', args: { tokenId: 42n } });
    const data = encodeAbiParameters(
        [{ type: 'uint16' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'uint64' }, { type: 'uint32' }],
        [resource, amount, amount, 0n, 1],
    );
    return { address: CELL as Address, topics, data, ...LOG_META } as unknown as Log;
}

function startedLog(resource: number, durationSec: number, yieldPerCycle: bigint, batches = 10): Log {
    const topics = encodeEventTopics({ abi: CELL_ABI, eventName: 'MiningStarted', args: { tokenId: 42n } });
    const data = encodeAbiParameters(
        [{ type: 'uint16' }, { type: 'uint32' }, { type: 'uint64' }, { type: 'uint32' }, { type: 'uint64' }],
        [resource, durationSec, yieldPerCycle, batches, 0n],
    );
    return { address: CELL as Address, topics, data, ...LOG_META } as unknown as Log;
}

const LOG_META = {
    blockHash: `0x${'0'.repeat(64)}`,
    blockNumber: 1n,
    logIndex: 0,
    transactionHash: `0x${'0'.repeat(64)}`,
    transactionIndex: 0,
    removed: false,
} as const;

function miningCell(process: Partial<RawCellProcessMiningView>, resources: RawCell['resources']): RawCell {
    return makeCell({
        tokenId: '42',
        owner: WALLET_ADDRESS,
        building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: null, modeRecipeId: null },
        process: makeMiningProcess({ resource: 3, ...process }),
        resources,
    });
}

const uncapped = (deposit: string) => [makeResource({ resourceId: 3, deposit, storage: null })];

describe('MiningService.getStatus', () => {
    it('reports the schedule and what the matured cycles would bank', async () => {
        const nowSec = 100_000;
        const cell = miningCell(
            { durationSec: 180, yieldPerCycle: 77, batches: 10, startAt: nowSec - (2 * 180 + 30) },
            uncapped('100000'),
        );
        const { service } = makeService({ cell, serverTime: nowSec });

        const status = await service.getStatus('42');

        expect(status.active).toBe(true);
        expect(status.targetResourceId).toBe(3);
        expect(status.yieldPerCycle).toBe(77);
        expect(status.batches).toBe(10);
        expect(status.completedBatches).toBe(2);
        expect(status.claimableBatches).toBe(2);
        expect(status.claimable).toBe('154');
        expect(status.isFinished).toBe(false);
        expect(status.nextBatchAtSec).toBe(nowSec - (2 * 180 + 30) + 3 * 180);
    });

    it('never banks past the schedule, however late the claim', async () => {
        const cell = miningCell({ durationSec: 10, yieldPerCycle: 10, batches: 10, startAt: 1 }, uncapped('100000'));
        const { service } = makeService({ cell });

        const status = await service.getStatus('42');

        expect(status.claimableBatches).toBe(10);
        expect(status.claimable).toBe('100');
        expect(status.isFinished).toBe(true);
        expect(status.nextBatchAtSec).toBeNull();
    });

    it('measures cycles from the cursor a claim advanced, without double-counting claimedBatches', async () => {
        const nowSec = 100_000;
        const cell = miningCell(
            { durationSec: 180, yieldPerCycle: 77, batches: 10, claimedBatches: 3, startAt: nowSec - 2 * 180 },
            uncapped('100000'),
        );
        const { service } = makeService({ cell, serverTime: nowSec });

        const status = await service.getStatus('42');

        expect(status.claimableBatches).toBe(2);
        expect(status.completedBatches).toBe(5);
        expect(status.claimable).toBe('154');
    });

    it('ends early on the deposit, draining its last partial cycle in full', async () => {
        const cell = miningCell({ durationSec: 10, yieldPerCycle: 77, batches: 1000, startAt: 1 }, uncapped('100'));
        const { service } = makeService({ cell });

        const status = await service.getStatus('42');

        expect(status.claimableBatches).toBe(2);
        expect(status.claimable).toBe('100');
        expect(status.depositRemaining).toBe('100');
    });

    it('drains more from the deposit than it credits on a partial-share extractor', async () => {
        const cell = miningCell({ durationSec: 10, yieldPerCycle: 100, batches: 1000, startAt: 1 }, uncapped('750'));
        const config = makeConfig();
        const mine = config.buildings.find((b) => b.type === BuildingType.Mine);
        if (mine === undefined) {
            throw new Error('expected a Mine in the fake config');
        }
        mine.effects = { ...mine.effects, extractionShareBp: 8000 };
        const { service } = makeService({ cell, config });

        const status = await service.getStatus('42');

        expect(status.claimableBatches).toBe(6);
        expect(status.claimable).toBe('600');
        expect(status.depositRemaining).toBe('750');
    });

    it('settles whole cycles only — a room that cannot take one banks nothing', async () => {
        const cell = miningCell({ durationSec: 10, yieldPerCycle: 10, batches: 100, startAt: 1 }, [
            makeResource({
                resourceId: 3,
                deposit: '500',
                balance: '95',
                storage: makeStorage({ used: '95', cap: '100' }),
            }),
        ]);
        const { service } = makeService({ cell });

        const status = await service.getStatus('42');

        expect(status.claimableBatches).toBe(0);
        expect(status.claimable).toBe('0');
    });

    it('banks only the whole cycles the room admits', async () => {
        const cell = miningCell({ durationSec: 10, yieldPerCycle: 10, batches: 100, startAt: 1 }, [
            makeResource({
                resourceId: 3,
                deposit: '500',
                balance: '75',
                storage: makeStorage({ used: '75', cap: '100' }),
            }),
        ]);
        const { service } = makeService({ cell });

        const status = await service.getStatus('42');

        expect(status.claimableBatches).toBe(2);
        expect(status.claimable).toBe('20');
    });

    it('does not call a stalled job finished — its schedule survives the wait', async () => {
        const nowSec = 100_000;
        const cell = miningCell({ durationSec: 10, yieldPerCycle: 10, batches: 10, startAt: nowSec - 15 * 10 }, [
            makeResource({
                resourceId: 3,
                deposit: '500',
                balance: '50',
                storage: makeStorage({ used: '50', cap: '50' }),
            }),
        ]);
        const { service } = makeService({ cell, serverTime: nowSec });

        const status = await service.getStatus('42');

        expect(status.stalled).toBe(true);
        expect(status.isFinished).toBe(false);
        expect(status.completedBatches).toBe(0);
        expect(status.claimableBatches).toBe(0);
        expect(status.nextBatchAtSec).toBeNull();
    });

    it('reports a full box as stalled with nothing claimable', async () => {
        const cell = miningCell({ durationSec: 10, yieldPerCycle: 10, batches: 100, startAt: 1 }, [
            makeResource({
                resourceId: 3,
                deposit: '500',
                balance: '50',
                storage: makeStorage({ used: '50', cap: '50' }),
            }),
        ]);
        const { service } = makeService({ cell });

        const status = await service.getStatus('42');

        expect(status.stalled).toBe(true);
        expect(status.claimable).toBe('0');
        expect(status.warehouseUsed).toBe('50');
        expect(status.warehouseCap).toBe('50');
    });

    it('retires a job predating bounded mining without crediting anything', async () => {
        const cell = miningCell({ durationSec: 10, yieldPerCycle: 10, batches: 0, startAt: 1 }, uncapped('500'));
        const { service } = makeService({ cell });

        const status = await service.getStatus('42');

        expect(status.isFinished).toBe(true);
        expect(status.claimableBatches).toBe(0);
        expect(status.claimable).toBe('0');
        expect(status.depositRemaining).toBe('500');
    });

    it('reports inactive when the cell has no mining process', async () => {
        const cell = makeCell({ tokenId: '42', owner: WALLET_ADDRESS });
        const { service } = makeService({ cell });

        const status = await service.getStatus('42');

        expect(status.active).toBe(false);
        expect(status.targetResourceId).toBeNull();
        expect(status.yieldPerCycle).toBeNull();
        expect(status.completedBatches).toBe(0);
        expect(status.nextBatchAtSec).toBeNull();
        expect(status.claimable).toBe('0');
    });

    it('throws when the cell is not in the map', async () => {
        const { service } = makeService();
        await expect(service.getStatus('42')).rejects.toThrow(/not in the current map/i);
    });
});

describe('MiningService.claim', () => {
    it('sends Cell.claim and decodes the mined amount', async () => {
        const { service, contracts } = makeService({ logs: [[minedLog(3, 120n)]] });

        const result = await service.claim('42');

        expect(contracts.sent).toHaveLength(1);
        const tx = contracts.sent[0];
        if (tx === undefined) {
            throw new Error('expected a claim tx');
        }
        expect(decodeFunctionData({ abi: CELL_ABI, data: tx.data as Hex }).functionName).toBe('claim');
        expect(result.resourceId).toBe(3);
        expect(result.claimedAmount).toBe('120');
        expect(result.claimedBatches).toBe(1);
    });

    it('reports nothing claimed when no ResourceMined event is emitted', async () => {
        const { service } = makeService();
        const result = await service.claim('42');
        expect(result.resourceId).toBeNull();
        expect(result.claimedAmount).toBe('0');
    });

    it('refuses when the wallet chainId does not match the chain config', async () => {
        const { service, contracts } = makeService({ walletChainId: 8453 });
        await expect(service.claim('42')).rejects.toThrow(/chain mismatch/i);
        expect(contracts.sent).toHaveLength(0);
    });
});

// A ready Mine (mines Iron=5 / Copper=6 in makeConfig) on an owned cell with an Iron deposit.
function mineCell(overrides: Partial<RawCell> = {}): RawCell {
    return makeCell({
        tokenId: '42',
        owner: WALLET_ADDRESS,
        building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: null, modeRecipeId: null },
        resources: [makeResource({ resourceId: 5, deposit: '1000' })],
        ...overrides,
    });
}

describe('MiningService.startMining', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('starts a bounded job on a ready extractor and decodes the schedule', async () => {
        const { service, contracts } = makeService({ cell: mineCell(), logs: [[startedLog(5, 180, 77n)]] });

        const result = await service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 });

        expect(contracts.sent).toHaveLength(1);
        const call = decodeFunctionData({ abi: CELL_ABI, data: contracts.sent[0]?.data as Hex });
        expect(call.functionName).toBe('startMining');
        expect(call.args).toEqual([42n, 5, 10]);
        expect(result.targetResourceId).toBe(5);
        expect(result.durationSec).toBe(180);
        expect(result.yieldPerCycle).toBe(77);
        expect(result.batches).toBe(10);
    });

    it('rejects a target the extractor cannot mine', async () => {
        const { service, contracts } = makeService({ cell: mineCell() });
        await expect(service.startMining({ tokenId: '42', targetResourceId: 102, batches: 10 })).rejects.toThrow(
            /cannot mine/i,
        );
        expect(contracts.sent).toHaveLength(0);
    });

    it('requires an explicit target when the extractor mines multiple resources', async () => {
        const { service } = makeService({ cell: mineCell() });
        await expect(service.startMining({ tokenId: '42', targetResourceId: null, batches: 10 })).rejects.toThrow(
            /pass targetResourceId/i,
        );
    });

    it('auto-picks the sole minable resource when the target is omitted', async () => {
        const config: AppConfig = makeConfig();
        config.buildings = config.buildings.map((b) =>
            b.type === BuildingType.Mine ? { ...b, minableResources: [5] } : b,
        );
        const { service, contracts } = makeService({ cell: mineCell(), config });

        const result = await service.startMining({ tokenId: '42', targetResourceId: null, batches: 10 });

        expect(result.targetResourceId).toBe(5);
        expect(contracts.sent).toHaveLength(1);
    });

    it('rejects while the extractor is still under construction', async () => {
        const future = DEFAULT_SERVER_TIME + 3600;
        const cell = mineCell({
            building: { type: BuildingType.Mine, buildFinishAt: future, modeResource: null, modeRecipeId: null },
        });
        const { service, contracts } = makeService({ cell });
        await expect(service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 })).rejects.toThrow(
            /still under construction/i,
        );
        expect(contracts.sent).toHaveLength(0);
    });

    it('rejects against the map clock even when the local wall clock reads far past finish', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(4_000_000_000 * 1000));
        const cell = mineCell({
            building: { type: BuildingType.Mine, buildFinishAt: 1000, modeResource: null, modeRecipeId: null },
        });
        const { service, contracts } = makeService({ cell, serverTime: 500 });
        await expect(service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 })).rejects.toThrow(
            /still under construction/i,
        );
        expect(contracts.sent).toHaveLength(0);
    });

    it('accepts against the map clock even when the local wall clock reads before finish', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(0));
        const cell = mineCell({
            building: { type: BuildingType.Mine, buildFinishAt: 1000, modeResource: null, modeRecipeId: null },
        });
        const { service, contracts } = makeService({ cell, serverTime: 1000, logs: [[startedLog(5, 180, 77n)]] });
        const result = await service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 });
        expect(result.targetResourceId).toBe(5);
        expect(contracts.sent).toHaveLength(1);
    });

    it('rejects when the building is a crafter, not an extractor', async () => {
        const cell = mineCell({
            building: { type: BuildingType.SteelMill, buildFinishAt: null, modeResource: null, modeRecipeId: null },
        });
        const { service } = makeService({ cell });
        await expect(service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 })).rejects.toThrow(
            /not an extractor/i,
        );
    });

    it('rejects when the cell has no live deposit for the target', async () => {
        const cell = mineCell({ resources: [makeResource({ resourceId: 5, deposit: '0' })] });
        const { service } = makeService({ cell });
        await expect(service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 })).rejects.toThrow(
            /no .*deposit/i,
        );
    });

    it('rejects a start on a cell owned by someone else', async () => {
        const cell = mineCell({ owner: '0xother' });
        const { service } = makeService({ cell });
        await expect(service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 })).rejects.toThrow(
            /do not own/i,
        );
    });
});

describe('MiningService.startMining mode switch cost', () => {
    it('prices the first pick on a fresh extractor as free and asks for no allowance', async () => {
        const { service, allowance } = makeService({
            cell: mineCell(),
            reads: { getCell: chainCellView({ modeResource: 0 }) },
            logs: [[startedLog(5, 180, 77n)]],
        });

        const result = await service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 });

        expect(result.modeSwitch.cost).toEqual({ kind: 'free', why: 'first_pick' });
        expect(result.modeSwitch.exact).toBe(true);
        expect(allowance.calls).toEqual([]);
    });

    it('prices restarting the same resource as free and asks for no allowance', async () => {
        const { service, allowance } = makeService({
            cell: mineCell(),
            reads: { getCell: chainCellView({ modeResource: 5 }) },
            logs: [[startedLog(5, 180, 77n)]],
        });

        const result = await service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 });

        expect(result.modeSwitch.cost).toEqual({ kind: 'free', why: 'same_output' });
        expect(allowance.calls).toEqual([]);
    });

    it('prices off the chain building type, not the map’s stale cheaper row after an upgrade', async () => {
        const config = makeConfig();
        const mine = config.buildings.find((b) => b.type === BuildingType.Mine);
        if (mine === undefined) {
            throw new Error('expected a Mine in the fake config');
        }
        config.buildings = [
            ...config.buildings,
            {
                ...mine,
                type: BuildingType.TungstenDrill,
                onChainId: 35,
                modeSwitch: { kind: ModeSwitchKind.Possible, costCpu: '9' },
            },
        ];
        const { service } = makeService({
            cell: mineCell(),
            config,
            reads: { getCell: chainCellView({ buildingType: 35, modeResource: 6 }) },
            logs: [[startedLog(5, 180, 77n), cpuBurnLog(WALLET_ADDRESS, parseEther('9'))]],
        });

        const result = await service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 });

        expect(result.modeSwitch.cost).toEqual({ kind: 'paid', costCpu: '9' });
        expect(result.modeSwitch.burnedCpu).toBe('9');
    });

    it('discloses the fee and covers it with an allowance when re-pointing the extractor', async () => {
        const { service, allowance } = makeService({
            cell: mineCell(),
            reads: { getCell: chainCellView({ modeResource: 6 }) },
            logs: [[startedLog(5, 180, 77n), cpuBurnLog(WALLET_ADDRESS, parseEther('1'))]],
        });

        const result = await service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 });

        expect(result.modeSwitch.cost).toEqual({ kind: 'paid', costCpu: '1' });
        expect(allowance.calls).toEqual([{ token: CPU_TOKEN, spender: CELL, needed: parseEther('1') }]);
    });

    it('prices against the mode the chain holds, not the one a lagging map holds', async () => {
        const cell = mineCell({
            building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: 5, modeRecipeId: null },
        });
        const { service } = makeService({
            cell,
            reads: { getCell: chainCellView({ modeResource: 6 }) },
            logs: [[startedLog(5, 180, 77n), cpuBurnLog(WALLET_ADDRESS, parseEther('1'))]],
        });

        const result = await service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 });

        expect(result.modeSwitch.cost).toEqual({ kind: 'paid', costCpu: '1' });
        expect(result.modeSwitch.exact).toBe(true);
    });

    it('still starts the job when the chain mode cannot be read, marking the price inexact', async () => {
        const cell = mineCell({
            building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: 6, modeRecipeId: null },
        });
        const { service, contracts } = makeService({
            cell,
            reads: { getCell: new Error('rpc is rate limited') },
            logs: [[startedLog(5, 180, 77n), cpuBurnLog(WALLET_ADDRESS, parseEther('1'))]],
        });

        const result = await service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 });

        expect(contracts.sent).toHaveLength(1);
        expect(result.modeSwitch.cost).toEqual({ kind: 'paid', costCpu: '1' });
        expect(result.modeSwitch.exact).toBe(false);
        expect(result.modeSwitch.burnedCpu).toBe('1');
    });

    it('discloses an unknown price as unknown and still covers the burn with an allowance', async () => {
        const config = makeConfig();
        config.buildings = config.buildings.map((b) =>
            b.type === BuildingType.Mine ? { ...b, modeSwitch: { kind: ModeSwitchKind.Unknown } } : b,
        );
        const { service, allowance } = makeService({
            cell: mineCell(),
            config,
            reads: { getCell: chainCellView({ modeResource: 6 }) },
            logs: [[startedLog(5, 180, 77n), cpuBurnLog(WALLET_ADDRESS, parseEther('1'))]],
        });

        const result = await service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 });

        expect(result.modeSwitch.cost).toEqual({ kind: 'unknown' });
        expect(allowance.calls[0]?.needed).toBe(MAX_APPROVE_AMOUNT);
        expect(result.modeSwitch.burnedCpu).toBe('1');
    });

    it('reports the burn the receipt actually carries, even when it contradicts the estimate', async () => {
        const { service } = makeService({
            cell: mineCell(),
            reads: { getCell: chainCellView({ modeResource: 0 }) },
            logs: [[startedLog(5, 180, 77n), cpuBurnLog(WALLET_ADDRESS, parseEther('3'))]],
        });

        const result = await service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 });

        expect(result.modeSwitch.cost).toEqual({ kind: 'free', why: 'first_pick' });
        expect(result.modeSwitch.burnedCpu).toBe('3');
    });

    it('reports a zero burn when the receipt carries no burn at all', async () => {
        const { service } = makeService({
            cell: mineCell(),
            reads: { getCell: chainCellView({ modeResource: 5 }) },
            logs: [[startedLog(5, 180, 77n)]],
        });

        const result = await service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 });

        expect(result.modeSwitch.burnedCpu).toBe('0');
    });

    it('ignores a burn by another wallet in the same transaction', async () => {
        const other = '0x000000000000000000000000000000000000bEEF' as Address;
        const { service } = makeService({
            cell: mineCell(),
            reads: { getCell: chainCellView({ modeResource: 5 }) },
            logs: [[startedLog(5, 180, 77n), cpuBurnLog(other, parseEther('9'))]],
        });

        const result = await service.startMining({ tokenId: '42', targetResourceId: 5, batches: 10 });

        expect(result.modeSwitch.burnedCpu).toBe('0');
    });
});
