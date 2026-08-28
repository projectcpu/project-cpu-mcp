import { describe, expect, it } from 'vitest';

import { WCPU_RESOURCE_ID } from '../../config/constants.js';
import { makeCell, makeResource, makeStorage, projectCell } from '../../map/__tests__/fixtures.js';
import type { Cell } from '../../map/types.js';
import { assessDestinationCapacity } from '../warehouse.utils.js';

const RESOURCE_ID = 5;

function capacityCell(
    balance: string,
    used: string,
    cap: string | null,
    incomingTransport = '0',
    lots = '0',
    resourceId = RESOURCE_ID,
): Cell {
    return projectCell(
        makeCell({
            resources: [
                makeResource({
                    resourceId,
                    balance,
                    storage: makeStorage({
                        used,
                        cellCap: cap,
                        reserved: { incomingTransport, lots },
                    }),
                }),
            ],
        }),
    );
}

describe('assessDestinationCapacity', () => {
    it('does not count incoming transport and lot reservations twice', () => {
        const cell = capacityCell('60', '80', '100', '15', '5');

        expect(assessDestinationCapacity(cell, RESOURCE_ID, 10n, 0n)).toEqual({
            fits: true,
            required: '10',
            free: '20',
        });
    });

    it('treats an uncapped shelf as having unlimited room', () => {
        const cell = capacityCell('60', '80', null, '15', '5', WCPU_RESOURCE_ID);

        expect(assessDestinationCapacity(cell, WCPU_RESOURCE_ID, 20n, null)).toEqual({
            fits: true,
            required: '20',
            free: null,
        });
    });

    it('uses the configured zero cap when a non-WCPU resource has no storage projection', () => {
        const cell = projectCell(makeCell({ resources: [makeResource({ resourceId: RESOURCE_ID, storage: null })] }));

        expect(assessDestinationCapacity(cell, RESOURCE_ID, 20n, 0n)).toEqual({
            fits: false,
            required: '20',
            free: '0',
        });
    });

    it('fits an amount that exactly fills the remaining room', () => {
        const cell = capacityCell('60', '80', '100', '15', '5');

        expect(assessDestinationCapacity(cell, RESOURCE_ID, 20n, 0n)).toEqual({
            fits: true,
            required: '20',
            free: '20',
        });
    });

    it('agrees with the projected full flag about whether room remains', () => {
        const cell = capacityCell('60', '80', '100', '15', '5');
        const storage = cell.resources[0]?.storage;
        const capacity = assessDestinationCapacity(cell, RESOURCE_ID, 1n, 0n);

        expect(storage?.full).toBe(false);
        expect(BigInt(capacity.free ?? '0')).toBeGreaterThan(0n);
    });
});
