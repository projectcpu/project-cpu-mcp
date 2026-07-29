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

import { BuildingType, CraftRecipeId } from '../../api/types.js';
import { CELL_ABI } from '../../contracts/cell.abi.js';
import { makeCell, makeResource, makeStorage } from '../../map/__tests__/fixtures.js';
import { CellProcessKind } from '../../map/types.js';
import { TxStatus } from '../../wallet/types.js';
import { recipeNameToUint64 } from '../cell.utils.js';
import { CraftService } from '../craft.service.js';
import type { CraftInput } from '../types.js';
import {
    APPROVE_HASH,
    CELL,
    CPU_TOKEN,
    chainCellView,
    cpuBurnLog,
    makeCellHarness,
    makeConfig,
    WALLET_ADDRESS,
} from './service-fakes.js';

const FORGE: CraftInput = { tokenId: '42', recipeId: CraftRecipeId.ForgeWcpu, batches: 1 };
const FORGE_X2: CraftInput = { tokenId: '42', recipeId: CraftRecipeId.ForgeWcpu, batches: 2 };
const STEEL: CraftInput = { tokenId: '42', recipeId: CraftRecipeId.SmeltSteel, batches: 2 };

function opexConfig(opexByType: Partial<Record<BuildingType, Record<string, string>>>) {
    const config = makeConfig();
    config.buildings = config.buildings.map((b) => ({ ...b, recipeOpexCpu: opexByType[b.type] ?? b.recipeOpexCpu }));
    return config;
}

function makeService(opts: Parameters<typeof makeCellHarness>[1] = {}) {
    return makeCellHarness((deps) => new CraftService(deps), opts);
}

function claimedLog(recipeId: bigint, batches: number, outResources: Array<number>, outAmounts: Array<bigint>): Log {
    const topics = encodeEventTopics({ abi: CELL_ABI, eventName: 'CraftClaimed', args: { tokenId: 42n } });
    const data = encodeAbiParameters(
        [
            { type: 'uint64' },
            { type: 'uint32' },
            { type: 'uint16[]' },
            { type: 'uint64[]' },
            { type: 'uint64' },
            { type: 'uint32' },
        ],
        [recipeId, batches, outResources, outAmounts, 0n, batches],
    );
    return {
        address: CELL as Address,
        topics,
        data,
        blockHash: `0x${'0'.repeat(64)}`,
        blockNumber: 1n,
        logIndex: 0,
        transactionHash: `0x${'0'.repeat(64)}`,
        transactionIndex: 0,
        removed: false,
    } as unknown as Log;
}

describe('CraftService.craft', () => {
    it('starts a free craft with no approve and encodes startCraft', async () => {
        const { service, contracts, allowance } = makeService();

        const result = await service.craft(STEEL);

        expect(allowance.calls).toHaveLength(0);
        expect(contracts.sent).toHaveLength(1);
        const tx = contracts.sent[0];
        if (tx === undefined) {
            throw new Error('expected a startCraft tx');
        }
        expect(tx.to).toBe(CELL);
        const decoded = decodeFunctionData({ abi: CELL_ABI, data: tx.data as Hex });
        expect(decoded.functionName).toBe('startCraft');
        expect(decoded.args).toEqual([42n, recipeNameToUint64(CraftRecipeId.SmeltSteel), 2]);
        expect(result.costCpu).toBe('0');
        expect(result.approveTxHash).toBeNull();
    });

    it('approves $CPU to the Cell for a paid forge and encodes startCraft', async () => {
        const { service, contracts, allowance } = makeService({ approve: APPROVE_HASH });

        const result = await service.craft(FORGE);

        expect(allowance.calls).toEqual([{ token: CPU_TOKEN, spender: CELL, needed: parseEther('100') }]);
        const tx = contracts.sent[0];
        if (tx === undefined) {
            throw new Error('expected a startCraft tx');
        }
        expect(decodeFunctionData({ abi: CELL_ABI, data: tx.data as Hex }).functionName).toBe('startCraft');
        expect(result.approveTxHash).toBe(APPROVE_HASH);
        expect(result.costCpu).toBe('100');
        expect(result.status).toBe(TxStatus.Success);
    });

    it('reports no approve tx when the allowance already covered the cost', async () => {
        const { service, allowance } = makeService({ approve: null });
        const result = await service.craft(FORGE);
        expect(allowance.calls).toHaveLength(1);
        expect(result.approveTxHash).toBeNull();
    });

    it('refuses a paid craft when $CPU is not configured and sends no tx', async () => {
        const { service, contracts, allowance } = makeService({ config: makeConfig('') });
        await expect(service.craft(FORGE)).rejects.toThrow(/not configured/i);
        expect(contracts.sent).toHaveLength(0);
        expect(allowance.calls).toHaveLength(0);
    });

    it('wraps an on-chain revert of the craft', async () => {
        const { service } = makeService({ receipts: [TxStatus.Reverted] });
        await expect(service.craft(FORGE)).rejects.toThrow(/craft transaction reverted/i);
    });

    it('refuses when the wallet chainId does not match the config', async () => {
        const { service, contracts } = makeService({ walletChainId: 8453 });
        await expect(service.craft(FORGE)).rejects.toThrow(/chain mismatch/i);
        expect(contracts.sent).toHaveLength(0);
    });

    it('refuses a craft when the warehouse lacks the recipe inputs (× batches) and sends no tx', async () => {
        // SmeltSteel needs 4 Iron/batch × 2 batches = 8; the cell holds only 3.
        const cell = makeCell({ tokenId: '42', resources: [makeResource({ resourceId: 5, balance: '3' })] });
        const { service, contracts, allowance } = makeService({ cell });
        await expect(service.craft(STEEL)).rejects.toThrow(/needs 8 Iron/i);
        expect(contracts.sent).toHaveLength(0);
        expect(allowance.calls).toHaveLength(0);
    });
});

describe('CraftService.getStatus', () => {
    it('computes matured and claimable batches from the map process', async () => {
        const cell = makeCell({
            tokenId: '42',
            process: {
                kind: CellProcessKind.Craft,
                recipeId: CraftRecipeId.SmeltSteel,
                batches: 2,
                claimedBatches: 0,
                durationSec: 60,
                startAt: 1,
            },
        });
        const { service } = makeService({ cell });

        const status = await service.getStatus('42');

        expect(status.active).toBe(true);
        expect(status.recipeId).toBe(CraftRecipeId.SmeltSteel);
        expect(status.completedBatches).toBe(2);
        expect(status.claimableBatches).toBe(2);
    });

    it('reports inactive when the cell has no craft process', async () => {
        const cell = makeCell({ tokenId: '42' });
        const { service } = makeService({ cell });
        const status = await service.getStatus('42');
        expect(status.active).toBe(false);
    });

    it('reports stalled with the recipe outputs whose warehouse is full', async () => {
        const config = makeConfig();
        config.recipes = config.recipes.map((r) =>
            r.id === CraftRecipeId.SmeltSteel ? { ...r, outputs: [{ resourceId: 102, amount: 10 }] } : r,
        );
        const cell = makeCell({
            tokenId: '42',
            process: {
                kind: CellProcessKind.Craft,
                recipeId: CraftRecipeId.SmeltSteel,
                batches: 2,
                claimedBatches: 0,
                durationSec: 60,
                startAt: 1,
            },
            resources: [
                {
                    resourceId: 102,
                    deposit: '0',
                    balance: '60',
                    strength: null,
                    storage: makeStorage({ used: '60', cap: '60' }),
                },
            ],
        });
        const { service } = makeService({ cell, config });

        const status = await service.getStatus('42');

        expect(status.stalled).toBe(true);
        expect(status.blockedResourceIds).toEqual([102]);
        expect(status.claimableBatches).toBe(0);
        expect(status.completedBatches).toBe(0);
        expect(status.isFinished).toBe(false);
        expect(status.nextBatchAtSec).toBeNull();
    });

    it('stalls before the box is full, naming the output with no room for a whole batch', async () => {
        const config = makeConfig();
        config.recipes = config.recipes.map((r) =>
            r.id === CraftRecipeId.SmeltSteel ? { ...r, outputs: [{ resourceId: 102, amount: 10 }] } : r,
        );
        const cell = makeCell({
            tokenId: '42',
            process: {
                kind: CellProcessKind.Craft,
                recipeId: CraftRecipeId.SmeltSteel,
                batches: 2,
                claimedBatches: 0,
                durationSec: 60,
                startAt: 1,
            },
            resources: [
                {
                    resourceId: 102,
                    deposit: '0',
                    balance: '57',
                    strength: null,
                    storage: makeStorage({ used: '57', cap: '60' }),
                },
            ],
        });
        const { service } = makeService({ cell, config });

        const status = await service.getStatus('42');

        expect(status.stalled).toBe(true);
        expect(status.blockedResourceIds).toEqual([102]);
        expect(status.claimableBatches).toBe(0);
    });
});

describe('CraftService.claim', () => {
    it('sends Cell.claim and decodes CraftClaimed outputs', async () => {
        const recipeId = recipeNameToUint64(CraftRecipeId.SmeltSteel);
        const { service, contracts } = makeService({ logs: [[claimedLog(recipeId, 2, [102], [10n])]] });

        const result = await service.claim('42');

        expect(decodeFunctionData({ abi: CELL_ABI, data: contracts.sent[0]?.data as Hex }).functionName).toBe('claim');
        expect(result.recipeId).toBe(CraftRecipeId.SmeltSteel);
        expect(result.batches).toBe(2);
        expect(result.claimedBatches).toBe(2);
        expect(result.outputs).toEqual([{ resourceId: 102, amount: '10' }]);
    });

    it('reports nothing claimed when no CraftClaimed event is emitted', async () => {
        const { service } = makeService();
        const result = await service.claim('42');
        expect(result.outputs).toHaveLength(0);
        expect(result.batches).toBe(0);
    });
});

function fabCell(modeRecipeId: string | null = null) {
    return makeCell({
        tokenId: '42',
        owner: WALLET_ADDRESS,
        building: { type: BuildingType.WaferFab, buildFinishAt: null, modeResource: null, modeRecipeId },
        resources: [makeResource({ resourceId: 5, deposit: '0', balance: '1000' })],
    });
}

describe('CraftService.craft mode switch cost', () => {
    it('folds the switch fee into the same allowance as the recipe cost', async () => {
        const { service, allowance, contracts } = makeService({
            cell: fabCell(CraftRecipeId.SmeltSteel),
            reads: {
                getCell: chainCellView({
                    buildingType: 17,
                    modeRecipeId: recipeNameToUint64(CraftRecipeId.SmeltSteel),
                }),
            },
            approve: APPROVE_HASH,
            logs: [[cpuBurnLog(WALLET_ADDRESS, parseEther('122'))]],
        });

        const result = await service.craft(FORGE);

        expect(allowance.calls).toEqual([{ token: CPU_TOKEN, spender: CELL, needed: parseEther('122') }]);
        expect(result.costCpu).toBe('100');
        expect(result.modeSwitch.cost).toEqual({ kind: 'paid', costCpu: '22' });
        expect(result.modeSwitch.burnedCpu).toBe('22');
        expect(contracts.sent).toHaveLength(1);
    });

    it('reports the recipe cost and the switch cost separately', async () => {
        const { service } = makeService({
            cell: fabCell(CraftRecipeId.SmeltSteel),
            reads: {
                getCell: chainCellView({
                    buildingType: 17,
                    modeRecipeId: recipeNameToUint64(CraftRecipeId.SmeltSteel),
                }),
            },
            logs: [[cpuBurnLog(WALLET_ADDRESS, parseEther('122'))]],
        });

        const result = await service.craft(FORGE);

        expect(result.costCpu).toBe('100');
        expect(result.modeSwitch.burnedCpu).toBe('22');
    });

    it('asks for no allowance when both the recipe and the switch are free', async () => {
        const { service, allowance } = makeService({
            cell: fabCell(CraftRecipeId.SmeltSteel),
            reads: {
                getCell: chainCellView({
                    buildingType: 17,
                    modeRecipeId: recipeNameToUint64(CraftRecipeId.SmeltSteel),
                }),
            },
        });

        const result = await service.craft(STEEL);

        expect(result.modeSwitch.cost).toEqual({ kind: 'free', why: 'same_output' });
        expect(allowance.calls).toEqual([]);
    });

    it('prices the switch against the chain’s recipe mode, not the map’s', async () => {
        const { service, allowance } = makeService({
            cell: fabCell(CraftRecipeId.ForgeWcpu),
            reads: {
                getCell: chainCellView({
                    buildingType: 17,
                    modeRecipeId: recipeNameToUint64(CraftRecipeId.SmeltSteel),
                }),
            },
            logs: [[cpuBurnLog(WALLET_ADDRESS, parseEther('122'))]],
        });

        const result = await service.craft(FORGE);

        expect(result.modeSwitch.cost).toEqual({ kind: 'paid', costCpu: '22' });
        expect(result.modeSwitch.exact).toBe(true);
        expect(allowance.calls[0]?.needed).toBe(parseEther('122'));
    });

    it('still starts the craft when the chain mode cannot be read, marking the price inexact', async () => {
        const { service, contracts } = makeService({
            cell: fabCell(CraftRecipeId.SmeltSteel),
            reads: { getCell: new Error('rpc is down') },
            logs: [[cpuBurnLog(WALLET_ADDRESS, parseEther('122'))]],
        });

        const result = await service.craft(FORGE);

        expect(contracts.sent).toHaveLength(1);
        expect(result.modeSwitch.cost).toEqual({ kind: 'paid', costCpu: '22' });
        expect(result.modeSwitch.exact).toBe(false);
        expect(result.modeSwitch.burnedCpu).toBe('22');
    });

    it('reports the switch burn the receipt carries even when the estimate said free', async () => {
        const { service } = makeService({
            cell: fabCell(),
            reads: { getCell: chainCellView({ buildingType: 17, modeRecipeId: 0n }) },
            logs: [[cpuBurnLog(WALLET_ADDRESS, parseEther('122'))]],
        });

        const result = await service.craft(FORGE);

        expect(result.modeSwitch.cost).toEqual({ kind: 'free', why: 'first_pick' });
        expect(result.modeSwitch.burnedCpu).toBe('22');
    });
});

describe('CraftService.craft opex', () => {
    it('prices the served opex on top of the recipe cost, scaled by batches', async () => {
        const { service, allowance } = makeService({
            config: opexConfig({ [BuildingType.WaferFab]: { forge_wcpu: '10' } }),
            cell: fabCell(CraftRecipeId.ForgeWcpu),
            reads: {
                getCell: chainCellView({ buildingType: 17, modeRecipeId: recipeNameToUint64(CraftRecipeId.ForgeWcpu) }),
            },
            approve: APPROVE_HASH,
            logs: [[cpuBurnLog(WALLET_ADDRESS, parseEther('220'))]],
        });

        const result = await service.craft(FORGE_X2);

        expect(result.costCpu).toBe('200');
        expect(result.opex).toEqual({ served: true, costCpu: '20' });
        expect(result.totalCpu).toBe('220');
        expect(result.modeSwitch.cost).toEqual({ kind: 'free', why: 'same_output' });
        expect(result.modeSwitch.burnedCpu).toBe('0');
        expect(allowance.calls).toEqual([{ token: CPU_TOKEN, spender: CELL, needed: parseEther('220') }]);
    });

    it('falls back to the base cost with the disclaimer flag when opex is not served', async () => {
        const { service, allowance } = makeService({
            cell: fabCell(CraftRecipeId.ForgeWcpu),
            reads: {
                getCell: chainCellView({ buildingType: 17, modeRecipeId: recipeNameToUint64(CraftRecipeId.ForgeWcpu) }),
            },
            approve: APPROVE_HASH,
            logs: [[cpuBurnLog(WALLET_ADDRESS, parseEther('100'))]],
        });

        const result = await service.craft(FORGE);

        expect(result.costCpu).toBe('100');
        expect(result.opex).toEqual({ served: false, costCpu: '0' });
        expect(result.totalCpu).toBe('100');
        expect(allowance.calls).toEqual([{ token: CPU_TOKEN, spender: CELL, needed: parseEther('100') }]);
    });

    it('keys the opex to the crafting building’s own type, not another crafter’s price', async () => {
        const { service, allowance } = makeService({
            config: opexConfig({
                [BuildingType.WaferFab]: { smelt_steel: '3', forge_wcpu: '10' },
                [BuildingType.SteelMill]: { smelt_steel: '99' },
            }),
            cell: fabCell(CraftRecipeId.SmeltSteel),
            reads: {
                getCell: chainCellView({
                    buildingType: 17,
                    modeRecipeId: recipeNameToUint64(CraftRecipeId.SmeltSteel),
                }),
            },
            approve: APPROVE_HASH,
            logs: [[cpuBurnLog(WALLET_ADDRESS, parseEther('6'))]],
        });

        const result = await service.craft(STEEL);

        expect(result.costCpu).toBe('0');
        expect(result.opex).toEqual({ served: true, costCpu: '6' });
        expect(result.totalCpu).toBe('6');
        expect(allowance.calls).toEqual([{ token: CPU_TOKEN, spender: CELL, needed: parseEther('6') }]);
    });

    it('attributes only the switch to the switch when a served-opex receipt burns base + opex + switch', async () => {
        const { service, allowance } = makeService({
            config: opexConfig({ [BuildingType.WaferFab]: { forge_wcpu: '10' } }),
            cell: fabCell(CraftRecipeId.SmeltSteel),
            reads: {
                getCell: chainCellView({
                    buildingType: 17,
                    modeRecipeId: recipeNameToUint64(CraftRecipeId.SmeltSteel),
                }),
            },
            approve: APPROVE_HASH,
            logs: [[cpuBurnLog(WALLET_ADDRESS, parseEther('132'))]],
        });

        const result = await service.craft(FORGE);

        expect(result.costCpu).toBe('100');
        expect(result.opex).toEqual({ served: true, costCpu: '10' });
        expect(result.totalCpu).toBe('110');
        expect(result.modeSwitch.cost).toEqual({ kind: 'paid', costCpu: '22' });
        expect(result.modeSwitch.burnedCpu).toBe('22');
        expect(allowance.calls).toEqual([{ token: CPU_TOKEN, spender: CELL, needed: parseEther('132') }]);
    });
});
