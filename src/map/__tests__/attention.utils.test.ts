import { getAddress } from 'viem';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    makeCell,
    makeCraftProcess,
    makeMiningProcess,
    makeProjectionConfig,
    makeResource,
    makeStorage,
} from './fixtures.js';
import { BuildingType, type OpenRevealRequestView } from '../../api/types.js';
import {
    attentionItem,
    buildAttentionReport,
    meetsSeverity,
    revealAttentionItems,
    withExtraItems,
} from '../attention.utils.js';
import { toCell } from '../cell-view.utils.js';
import { REVEAL_RETRY_CEILING_SECONDS, REVEAL_RETRY_FLOOR_SECONDS } from '../constants.js';
import { AttentionReason, AttentionSeverity, type AttentionItem } from '../types.js';

const BASE = {
    version: 100,
    serverTime: 10,
    nearFullPct: 90,
    ...makeProjectionConfig(),
    extractorBuildingTypes: new Set<string>([BuildingType.Mine]),
};

function report(cells: Array<Parameters<typeof makeCell>[0]>, craftOutputsByRecipe = {}) {
    const config = makeProjectionConfig({ craftOutputsByRecipe });
    return buildAttentionReport({
        ...BASE,
        ...config,
        ownedCells: cells.map((o) => toCell(makeCell(o), BASE.serverTime, config)),
    });
}

describe('buildAttentionReport', () => {
    it('returns an empty, owner-unknown report when the wallet is unknown', () => {
        const r = buildAttentionReport({ ...BASE, ownedCells: null });
        expect(r.ownerKnown).toBe(false);
        expect(r.items).toEqual([]);
        expect(r.counts).toEqual({ critical: 0, warning: 0, info: 0 });
    });

    it('flags stalled mining as critical with the used breakdown', () => {
        const r = report([
            {
                tokenId: '1',
                revealCount: 1,
                building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: null, modeRecipeId: null },
                process: makeMiningProcess({ resource: 7 }),
                resources: [
                    makeResource({
                        resourceId: 7,
                        deposit: '1000',
                        balance: '20',
                        storage: makeStorage({
                            used: '50',
                            cellCap: '50',
                            hubCap: '50',
                            reserved: { incomingTransport: '30', lots: '0' },
                        }),
                    }),
                ],
            },
        ]);
        expect(r.items).toHaveLength(1);
        const [item] = r.items;
        expect(item?.reason).toBe(AttentionReason.StalledMining);
        expect(item?.severity).toBe(AttentionSeverity.Critical);
        expect(item?.resourceId).toBe(7);
        expect(item?.fillPct).toBe(100);
        expect(item?.breakdown).toEqual({ liquid: '20', incomingTransport: '30', lots: '0' });
    });

    it('flags one stalled_craft item per full output box', () => {
        const r = report(
            [
                {
                    tokenId: '2',
                    revealCount: 1,
                    building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: null, modeRecipeId: null },
                    process: makeCraftProcess({ recipeId: 'refine' }),
                    resources: [
                        makeResource({
                            resourceId: 10,
                            deposit: '1000',
                            storage: makeStorage({ used: '60', cellCap: '60', hubCap: '60' }),
                        }),
                        makeResource({
                            resourceId: 11,
                            deposit: '1000',
                            storage: makeStorage({ used: '60', cellCap: '60', hubCap: '60' }),
                        }),
                        // Not an output of this recipe → must not be flagged even though its box is full.
                        makeResource({
                            resourceId: 99,
                            deposit: '1000',
                            storage: makeStorage({ used: '60', cellCap: '60', hubCap: '60' }),
                        }),
                    ],
                },
            ],
            {
                refine: [
                    { resourceId: 10, amount: 20 },
                    { resourceId: 11, amount: 20 },
                ],
            },
        );
        const stalled = r.items.filter((i) => i.reason === AttentionReason.StalledCraft);
        expect(stalled.map((i) => i.resourceId).sort()).toEqual([10, 11]);
        expect(r.counts.critical).toBe(2);
    });

    it('flags a stalled craft output that has no resource row yet', () => {
        const projectionConfig = makeProjectionConfig({
            craftOutputsByRecipe: { recipe: [{ resourceId: 10, amount: 40 }] },
            storageCapsByResource: { 10: { cellCap: 20n, hubCap: 200n } },
        });
        const cell = toCell(
            makeCell({
                tokenId: '1',
                process: makeCraftProcess({ recipeId: 'recipe', batches: 5, claimedBatches: 0 }),
                resources: [],
            }),
            BASE.serverTime,
            projectionConfig,
        );

        const result = buildAttentionReport({
            ...BASE,
            ...projectionConfig,
            ownedCells: [cell],
        });

        expect(result.items).toContainEqual(
            expect.objectContaining({
                reason: AttentionReason.StalledCraft,
                resourceId: 10,
                used: '0',
                cap: '20',
            }),
        );
    });

    it('does not report a blocked shelf as Stall after the Process is terminal', () => {
        const projectionConfig = makeProjectionConfig({
            craftOutputsByRecipe: { recipe: [{ resourceId: 10, amount: 40 }] },
        });
        const cell = toCell(
            makeCell({
                tokenId: '1',
                process: makeCraftProcess({ recipeId: 'recipe', batches: 1, claimedBatches: 1 }),
                resources: [
                    makeResource({
                        resourceId: 10,
                        storage: makeStorage({ used: '20', cellCap: '20', hubCap: '200' }),
                    }),
                ],
            }),
            BASE.serverTime,
            projectionConfig,
        );

        const result = buildAttentionReport({
            ...BASE,
            ...projectionConfig,
            ownedCells: [cell],
        });

        expect(result.items.map((item) => item.reason)).not.toContain(AttentionReason.StalledCraft);
        expect(result.items.map((item) => item.reason)).toContain(AttentionReason.ProcessFinished);
    });

    it('flags near-full only for actively produced resources', () => {
        const r = report([
            {
                tokenId: '3',
                revealCount: 1,
                building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: null, modeRecipeId: null },
                process: makeMiningProcess({ resource: 5, yieldPerCycle: 5 }),
                resources: [
                    // Mined resource at 95%, still room for a whole cycle → warning, not a stall.
                    makeResource({
                        resourceId: 5,
                        deposit: '1000',
                        storage: makeStorage({ used: '95', cellCap: '100', hubCap: '100' }),
                    }),
                    // A different resource, also 95% but nothing produces it → not flagged.
                    makeResource({
                        resourceId: 6,
                        deposit: '1000',
                        storage: makeStorage({ used: '95', cellCap: '100', hubCap: '100' }),
                    }),
                ],
            },
        ]);
        const nearFull = r.items.filter((i) => i.reason === AttentionReason.WarehouseNearFull);
        expect(nearFull).toHaveLength(1);
        expect(nearFull[0]?.resourceId).toBe(5);
        expect(nearFull[0]?.severity).toBe(AttentionSeverity.Warning);
    });

    it('never flags an uncapped (cap null) warehouse', () => {
        const r = report([
            {
                tokenId: '4',
                revealCount: 1,
                building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: null, modeRecipeId: null },
                process: makeMiningProcess({ resource: 1 }),
                resources: [
                    makeResource({
                        resourceId: 1,
                        deposit: '1000',
                        storage: makeStorage({ used: '999999', cellCap: null, hubCap: null }),
                    }),
                ],
            },
        ]);
        expect(r.items).toEqual([]);
    });

    it('flags a built extractor sitting on depleted deposits, but not one mid-construction', () => {
        // A finished extractor keeps a past buildFinishAt (only demolish clears it to null); operational
        // means buildFinishAt <= serverTime (10 here), a future one is still under construction.
        const built = report([
            {
                tokenId: '5',
                revealCount: 1,
                building: { type: BuildingType.Mine, buildFinishAt: 5, modeResource: null, modeRecipeId: null },
                resources: [makeResource({ resourceId: 1, deposit: '0' })],
            },
        ]);
        expect(built.items.map((i) => i.reason)).toContain(AttentionReason.DepositDepleted);
        expect(built.items.find((i) => i.reason === AttentionReason.DepositDepleted)?.depositRemaining).toBe('0');

        const constructing = report([
            {
                tokenId: '6',
                revealCount: 1,
                building: { type: BuildingType.Mine, buildFinishAt: 9_999_999, modeResource: null, modeRecipeId: null },
                resources: [makeResource({ resourceId: 1, deposit: '0' })],
            },
        ]);
        expect(constructing.items).toEqual([]);
    });

    it('flags an upgraded extractor on a depleted deposit, following the catalog set not a fixed enum', () => {
        const cell = toCell(
            makeCell({
                tokenId: '11',
                revealCount: 1,
                building: { type: 'mine_l2a', buildFinishAt: 5, modeResource: null, modeRecipeId: null },
                resources: [makeResource({ resourceId: 1, deposit: '0' })],
            }),
            BASE.serverTime,
            makeProjectionConfig(),
        );
        const r = buildAttentionReport({
            ...BASE,
            extractorBuildingTypes: new Set<string>(['mine_l2a']),
            ownedCells: [cell],
        });
        expect(r.items.map((i) => i.reason)).toContain(AttentionReason.DepositDepleted);
    });

    it('flags a job that has run its scheduled cycles, but not one still running', () => {
        const finished = report([
            {
                tokenId: '7',
                revealCount: 1,
                building: { type: BuildingType.Mine, buildFinishAt: 5, modeResource: null, modeRecipeId: null },
                process: makeMiningProcess({ resource: 1, durationSec: 10, batches: 1, startAt: 0 }),
                resources: [makeResource({ resourceId: 1, deposit: '1000' })],
            },
        ]);
        const item = finished.items.find((i) => i.reason === AttentionReason.ProcessFinished);
        expect(item?.severity).toBe(AttentionSeverity.Warning);
        expect(item?.resourceId).toBe(1);

        const running = report([
            {
                tokenId: '8',
                revealCount: 1,
                building: { type: BuildingType.Mine, buildFinishAt: 5, modeResource: null, modeRecipeId: null },
                process: makeMiningProcess({ resource: 1, durationSec: 10, batches: 5, startAt: 0 }),
                resources: [makeResource({ resourceId: 1, deposit: '1000' })],
            },
        ]);
        expect(running.items.map((i) => i.reason)).not.toContain(AttentionReason.ProcessFinished);
    });

    it('flags a job predating bounded mining as finished, since its first claim retires it', () => {
        const r = report([
            {
                tokenId: '9',
                revealCount: 1,
                building: { type: BuildingType.Mine, buildFinishAt: 5, modeResource: null, modeRecipeId: null },
                process: makeMiningProcess({ resource: 1, batches: 0, startAt: 0 }),
                resources: [makeResource({ resourceId: 1, deposit: '1000' })],
            },
        ]);
        expect(r.items.map((i) => i.reason)).toContain(AttentionReason.ProcessFinished);
    });

    it('flags a finished craft too — the schedule is one rule for both kinds', () => {
        const r = report(
            [
                {
                    tokenId: '10',
                    revealCount: 1,
                    building: { type: BuildingType.Mine, buildFinishAt: 5, modeResource: null, modeRecipeId: null },
                    process: makeCraftProcess({ recipeId: 'refine', durationSec: 10, batches: 1, startAt: 0 }),
                    resources: [
                        makeResource({
                            resourceId: 10,
                            deposit: '1000',
                            storage: makeStorage({ cellCap: '100', hubCap: '100' }),
                        }),
                    ],
                },
            ],
            { refine: [{ resourceId: 10, amount: 20 }] },
        );
        const item = r.items.find((i) => i.reason === AttentionReason.ProcessFinished);
        expect(item?.severity).toBe(AttentionSeverity.Warning);
        expect(item?.resourceId).toBeNull();
    });

    it('flags a revealed cell with no building as info, but not a reveal-pending one', () => {
        const unbuilt = report([{ tokenId: '7', revealCount: 1, building: null }]);
        expect(unbuilt.items).toHaveLength(1);
        expect(unbuilt.items[0]?.reason).toBe(AttentionReason.Unbuilt);
        expect(unbuilt.items[0]?.severity).toBe(AttentionSeverity.Info);

        const pending = report([{ tokenId: '8', revealCount: 1, building: null, revealPending: true }]);
        expect(pending.items).toEqual([]);
    });

    it('flags a just-demolished cell as demolition cooldown rather than unbuilt', () => {
        // serverTime is 10; a future demolishFinishAt means the plot is still locked from rebuilding.
        const cooling = report([{ tokenId: '10', revealCount: 1, building: null, demolishFinishAt: 100 }]);
        expect(cooling.items).toHaveLength(1);
        expect(cooling.items[0]?.reason).toBe(AttentionReason.DemolishCooldown);
        expect(cooling.items[0]?.severity).toBe(AttentionSeverity.Info);
        expect(cooling.items[0]?.arrivalAt).toBe(100);

        // Once the cooldown has elapsed (<= serverTime), it is a plain unbuilt plot again.
        const elapsed = report([{ tokenId: '11', revealCount: 1, building: null, demolishFinishAt: 5 }]);
        expect(elapsed.items[0]?.reason).toBe(AttentionReason.Unbuilt);
    });

    it('names what is coming down on a demolition cooldown item, so a replacement can be planned from the list', () => {
        const cooling = report([
            {
                tokenId: '10',
                revealCount: 1,
                building: null,
                demolishFinishAt: 100,
                demolishStartAt: 4,
                demolishingType: 'mine',
            },
        ]);
        expect(cooling.items[0]?.demolishingType).toBe('mine');
        expect(cooling.items[0]?.arrivalAt).toBe(100);
    });

    it('keeps the demolition cooldown item when the type was never recorded, leaving it unknown', () => {
        const cooling = report([{ tokenId: '10', revealCount: 1, building: null, demolishFinishAt: 100 }]);
        expect(cooling.items[0]?.reason).toBe(AttentionReason.DemolishCooldown);
        expect(cooling.items[0]?.demolishingType).toBeNull();
    });

    it('leaves the demolishing type null on every other reason', () => {
        const unbuilt = report([{ tokenId: '7', revealCount: 1, building: null }]);
        expect(unbuilt.items[0]?.demolishingType).toBeNull();
    });

    it('does not flag hubs for storage', () => {
        const r = report([
            {
                tokenId: '9',
                revealCount: 1,
                building: { type: BuildingType.Hub, buildFinishAt: null, modeResource: null, modeRecipeId: null },
                resources: [
                    makeResource({
                        resourceId: 1,
                        storage: makeStorage({ used: '500', cellCap: '500', hubCap: '500' }),
                    }),
                ],
            },
        ]);
        expect(r.items).toEqual([]);
    });

    it('sorts most-urgent first and counts by severity', () => {
        const r = report([
            { tokenId: 'b', revealCount: 1, building: null },
            {
                tokenId: 'a',
                revealCount: 1,
                building: { type: BuildingType.Mine, buildFinishAt: null, modeResource: null, modeRecipeId: null },
                process: makeMiningProcess({ resource: 1 }),
                resources: [
                    makeResource({
                        resourceId: 1,
                        deposit: '1000',
                        storage: makeStorage({ used: '50', cellCap: '50', hubCap: '50' }),
                    }),
                ],
            },
        ]);
        expect(r.items.map((i) => i.severity)).toEqual([AttentionSeverity.Critical, AttentionSeverity.Info]);
        expect(r.counts).toEqual({ critical: 1, warning: 0, info: 1 });
    });
});

describe('lot attention reasons', () => {
    it('grades a frozen lot as warning and an at-risk lot as info', () => {
        expect(attentionItem({ tokenId: 'h' }, AttentionReason.LotFrozen).severity).toBe(AttentionSeverity.Warning);
        expect(attentionItem({ tokenId: 'h' }, AttentionReason.LotAtRisk).severity).toBe(AttentionSeverity.Info);
    });

    it('lets the severity filter keep frozen but drop at-risk at a warning floor', () => {
        expect(meetsSeverity(AttentionSeverity.Warning, AttentionSeverity.Warning)).toBe(true);
        expect(meetsSeverity(AttentionSeverity.Info, AttentionSeverity.Warning)).toBe(false);
    });
});

const CURRENT_SOURCE = getAddress('0xabc1230000000000000000000000000000000001');
const CURRENT_SOURCE_ON_WIRE = CURRENT_SOURCE.toLowerCase();
const RETIRED_SOURCE_ON_WIRE = '0x00000000000000000000000000000000000000b2';
const SERVER_TIME = 1_700_000_500;
const MS = 1_000;

function openRequest(over: Partial<OpenRevealRequestView> = {}): OpenRevealRequestView {
    return {
        requestId: '7',
        source: CURRENT_SOURCE_ON_WIRE,
        tokenId: '42',
        requestedAt: SERVER_TIME - 300,
        ...over,
    };
}

function revealItems(requests: Array<OpenRevealRequestView>, currentSource: string = CURRENT_SOURCE) {
    return revealAttentionItems({ currentSource, serverTime: SERVER_TIME, requests });
}

describe('revealAttentionItems', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('holds the wire source and the current source in deliberately different letter case', () => {
        expect(CURRENT_SOURCE_ON_WIRE).not.toBe(CURRENT_SOURCE);
        expect(CURRENT_SOURCE_ON_WIRE.toLowerCase()).toBe(CURRENT_SOURCE.toLowerCase());
    });

    it('raises a critical item for a request open exactly at the two-minute mark', () => {
        const [item, ...rest] = revealItems([openRequest({ requestedAt: SERVER_TIME - 120 })]);
        expect(rest).toEqual([]);
        expect(item?.reason).toBe(AttentionReason.RevealStuck);
        expect(item?.severity).toBe(AttentionSeverity.Critical);
        expect(item?.tokenId).toBe('42');
        expect(item?.requestId).toBe('7');
        expect(item?.requestedAt).toBe(SERVER_TIME - 120);
        expect(item?.message).toContain('open for 120 seconds');
    });

    it('leaves a request one second short of the mark alone', () => {
        expect(revealItems([openRequest({ requestedAt: SERVER_TIME - 119 })])).toEqual([]);
    });

    it('leaves a request opened a moment ago alone', () => {
        expect(revealItems([openRequest({ requestedAt: SERVER_TIME - 1 })])).toEqual([]);
    });

    it('measures the wait against the answer server time when the local clock runs hours ahead', () => {
        vi.useFakeTimers();
        vi.setSystemTime((SERVER_TIME + 36_000) * MS);
        expect(revealItems([openRequest({ requestedAt: SERVER_TIME - 60 })])).toEqual([]);
    });

    it('measures the wait against the answer server time when the local clock runs hours behind', () => {
        vi.useFakeTimers();
        vi.setSystemTime((SERVER_TIME - 36_000) * MS);
        const [item] = revealItems([openRequest({ requestedAt: SERVER_TIME - 300 })]);
        expect(item?.reason).toBe(AttentionReason.RevealStuck);
        expect(item?.message).toContain('open for 300 seconds');
    });

    it('raises a stuck item for a request whose open time was never recorded', () => {
        const [item, ...rest] = revealItems([openRequest({ requestedAt: null })]);
        expect(rest).toEqual([]);
        expect(item?.reason).toBe(AttentionReason.RevealStuck);
        expect(item?.severity).toBe(AttentionSeverity.Critical);
        expect(item?.requestedAt).toBeNull();
        expect(item?.message).toContain('carries no open time');
    });

    it('reads a source that differs from the current one only in letter case as the current one', () => {
        const [item, ...rest] = revealItems([openRequest({ requestedAt: SERVER_TIME - 300 })]);
        expect(rest).toEqual([]);
        expect(item?.reason).toBe(AttentionReason.RevealStuck);
    });

    it('names the admin cleanup as the only way out of a cell locked by a retired source', () => {
        const [item, ...rest] = revealItems([
            openRequest({ requestId: '9', source: RETIRED_SOURCE_ON_WIRE, requestedAt: SERVER_TIME - 5 }),
        ]);
        expect(rest).toEqual([]);
        expect(item?.reason).toBe(AttentionReason.RevealSourceRetired);
        expect(item?.severity).toBe(AttentionSeverity.Critical);
        expect(item?.tokenId).toBe('42');
        expect(item?.requestId).toBe('9');
        expect(item?.message).toContain(RETIRED_SOURCE_ON_WIRE);
        expect(item?.message).toContain(CURRENT_SOURCE);
        expect(item?.message).toMatch(/admin of the contracts clears it on-chain/);
        expect(item?.message).toMatch(/only way out/);
        expect(item?.message).toMatch(/retrying it will never clear the cell/);
    });

    it('raises the retired-source item alone for a request already past the stuck mark', () => {
        const [item, ...rest] = revealItems([
            openRequest({ requestId: '9', source: RETIRED_SOURCE_ON_WIRE, requestedAt: SERVER_TIME - 300 }),
        ]);
        expect(rest).toEqual([]);
        expect(item?.reason).toBe(AttentionReason.RevealSourceRetired);
    });

    it('carries the open time of a long-locked request on the retired-source item', () => {
        const [item] = revealItems([
            openRequest({ requestId: '9', source: RETIRED_SOURCE_ON_WIRE, requestedAt: SERVER_TIME - 300 }),
        ]);
        expect(item?.requestId).toBe('9');
        expect(item?.requestedAt).toBe(SERVER_TIME - 300);
    });

    it('describes the widening background retry and what an open request costs the cell', () => {
        const [item] = revealItems([openRequest({ requestedAt: SERVER_TIME - 300 })]);
        expect(item?.message).toContain(`no sooner than every ${REVEAL_RETRY_FLOOR_SECONDS} seconds`);
        expect(item?.message).toContain(`up to ${REVEAL_RETRY_CEILING_SECONDS} seconds between tries`);
        expect(item?.message).toContain('no new draw and no further reveal can be requested');
        expect(item?.message).not.toMatch(/every minute/);
        expect(item?.message).not.toMatch(/keeps the deposits/);
    });

    it('claims no settlement pass has failed when the open time is unknown', () => {
        const [item] = revealItems([openRequest({ requestedAt: null })]);
        expect(item?.message).not.toMatch(/still has not closed it/);
        expect(item?.message).not.toMatch(/settlement passes/);
    });

    it('keeps the retired-source item apart from the stuck one in a mixed list', () => {
        const items = revealItems([
            openRequest({ requestId: '1', tokenId: '10', requestedAt: SERVER_TIME - 10 }),
            openRequest({ requestId: '2', tokenId: '20', requestedAt: SERVER_TIME - 300 }),
            openRequest({
                requestId: '3',
                tokenId: '30',
                source: RETIRED_SOURCE_ON_WIRE,
                requestedAt: SERVER_TIME - 1,
            }),
        ]);
        expect(items.map((i) => [i.tokenId, i.reason])).toEqual([
            ['20', AttentionReason.RevealStuck],
            ['30', AttentionReason.RevealSourceRetired],
        ]);
    });

    it('keeps the request reveal counter out of the item it builds', () => {
        const [item] = revealItems([
            { ...openRequest({ requestedAt: null }), revealEpoch: 3 } as OpenRevealRequestView,
        ]);
        expect(Object.keys(item ?? {})).not.toContain('revealEpoch');
        expect(JSON.stringify(item)).not.toContain('revealEpoch');
    });

    it('returns nothing for an owner with no open requests', () => {
        expect(revealItems([])).toEqual([]);
    });
});

describe('withExtraItems', () => {
    it('merges extra items, re-sorts, re-counts, and sets the note', () => {
        const base = report([{ tokenId: 'z', revealCount: 1, building: null }]);
        const extra: AttentionItem = {
            tokenId: 'd',
            severity: AttentionSeverity.Warning,
            reason: AttentionReason.DeliveryReady,
            resourceId: 3,
            used: null,
            cap: null,
            fillPct: null,
            breakdown: null,
            depositRemaining: null,
            deliveryId: '77',
            arrivalAt: 1,
            demolishingType: null,
            lotId: null,
            requestId: null,
            requestedAt: null,
            message: null,
        };
        const merged = withExtraItems(base, [extra], 'deliveries offline');
        expect(merged.items[0]?.severity).toBe(AttentionSeverity.Warning);
        expect(merged.counts).toEqual({ critical: 0, warning: 1, info: 1 });
        expect(merged.note).toBe('deliveries offline');
    });
});
