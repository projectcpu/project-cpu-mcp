import { describe, expect, it } from 'vitest';

import { parseCell, parseSnapshot } from '../map.utils.js';

function rawCell(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return { tokenId: '1', owner: '0xowner', revealCount: 1, resources: [], updated: 1, ...overrides };
}

describe('rawCellSchema fee fields', () => {
    it('defaults both fee records to null when the server omits them', () => {
        const cell = parseCell(rawCell());
        expect(cell).not.toBeNull();
        expect(cell?.transitFeeOverrides).toBeNull();
        expect(cell?.saleFeeOverrides).toBeNull();
    });

    it('distinguishes "not a transit point" (null) from "charges defaults" ({}) for transit fees', () => {
        expect(parseCell(rawCell({ transitFeeOverrides: null }))?.transitFeeOverrides).toBeNull();
        expect(parseCell(rawCell({ transitFeeOverrides: {} }))?.transitFeeOverrides).toEqual({});
    });

    it('keeps per-resource transit overrides as decimal strings', () => {
        const cell = parseCell(rawCell({ transitFeeOverrides: { 5: '0.5', 6: '0' } }));
        expect(cell?.transitFeeOverrides).toEqual({ 5: '0.5', 6: '0' });
    });

    it('converts sale-fee overrides from basis points to percent, preserving a real 0 rate', () => {
        const cell = parseCell(rawCell({ saleFeeOverrides: { 5: 250, 6: 5000, 7: 0 } }));
        expect(cell?.saleFeeOverrides).toEqual({ 5: 2.5, 6: 50, 7: 0 });
    });

    it('reads an empty sale-fee record as a hub-kind building that has set no rates, and null as no hub at all', () => {
        expect(parseCell(rawCell({ saleFeeOverrides: {} }))?.saleFeeOverrides).toEqual({});
        expect(parseCell(rawCell({ saleFeeOverrides: null }))?.saleFeeOverrides).toBeNull();
    });

    it('keeps a building type the client does not enumerate, so an upgraded cell is not silently dropped', () => {
        expect(parseCell(rawCell({ building: { type: 'oil_power_plant_l2a', buildFinishAt: null } }))).not.toBeNull();
    });

    it('still drops a structurally invalid cell rather than the whole snapshot', () => {
        expect(parseCell(rawCell({ building: { type: 'hub', buildFinishAt: 'soon' } }))).toBeNull();
    });
});

describe('rawCellSchema building mode fields', () => {
    it('keeps every cell that has a building when the payload predates the mode fields, reading the mode as null', () => {
        const raw = {
            serverTime: 1000,
            version: 5,
            cells: [
                rawCell({ tokenId: '1', building: { type: 'mine', buildFinishAt: null } }),
                rawCell({ tokenId: '2', building: { type: 'hub', buildFinishAt: 10 } }),
            ],
        };

        const { snapshot, dropped } = parseSnapshot(raw);

        expect(dropped).toBe(0);
        expect(snapshot.cells.map((c) => c.tokenId)).toEqual(['1', '2']);
        expect(snapshot.cells[0]?.building?.modeResource).toBeNull();
        expect(snapshot.cells[0]?.building?.modeRecipeId).toBeNull();
    });

    it('parses both mode fields through when the payload carries them', () => {
        const mine = parseCell(
            rawCell({ building: { type: 'mine', buildFinishAt: null, modeResource: 5, modeRecipeId: null } }),
        );
        const fab = parseCell(
            rawCell({
                building: { type: 'wafer_fab', buildFinishAt: null, modeResource: null, modeRecipeId: 'make_chips' },
            }),
        );

        expect(mine?.building?.modeResource).toBe(5);
        expect(fab?.building?.modeRecipeId).toBe('make_chips');
    });

    it('keeps a cell whose mode names a recipe this client does not know yet', () => {
        const cell = parseCell(
            rawCell({
                building: { type: 'wafer_fab', buildFinishAt: null, modeResource: null, modeRecipeId: 'brand_new' },
            }),
        );

        expect(cell?.building?.modeRecipeId).toBe('brand_new');
    });
});

describe('rawCellSchema wire shape', () => {
    it('parses a resource whose storage carries no stall flag', () => {
        const cell = parseCell(
            rawCell({
                resources: [
                    {
                        resourceId: 1,
                        deposit: '100',
                        balance: '0',
                        storage: { used: '10', cap: '100', reserved: { incomingTransport: '0', lots: '0' } },
                    },
                ],
            }),
        );

        expect(cell?.resources[0]?.storage).toMatchObject({ used: '10', cap: '100' });
    });

    it('parses a process that carries no stall flag', () => {
        const cell = parseCell(
            rawCell({
                process: {
                    kind: 'mining',
                    resource: 1,
                    durationSec: 180,
                    yieldPerCycle: 77,
                    batches: 10,
                    claimedBatches: 3,
                    startAt: 1,
                },
            }),
        );

        expect(cell?.process).toMatchObject({ resource: 1, yieldPerCycle: 77, batches: 10, claimedBatches: 3 });
    });

    it('drops a mining process still carrying the pre-bounded-job shape', () => {
        const cell = parseCell(
            rawCell({ process: { kind: 'mining', resource: 1, durationSec: 180, batch: 77, startAt: 1 } }),
        );

        expect(cell).toBeNull();
    });
});
