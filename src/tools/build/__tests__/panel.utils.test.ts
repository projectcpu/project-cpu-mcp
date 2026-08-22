import { describe, expect, it } from 'vitest';

import { BuildingType } from '../../../api/types.js';
import { makeConfig } from '../../../services/__tests__/service-fakes.js';
import type { AppConfig, BuildResult, UpgradeResult } from '../../../services/types.js';
import { PANEL_FIELD_SEPARATOR, PANEL_LABEL_SEPARATOR, PANEL_MAX_WIDTH } from '../../../utils/panel.constants.js';
import { TxStatus } from '../../../wallet/types.js';
import { buildPanel, upgradePanel } from '../panel.utils.js';

const BUILD_FIELDS = ['Cell', 'Building', 'Status', 'Finishes in', 'Paid', 'Approve tx', 'Build tx', 'Purpose', 'Next'];
const UPGRADE_FIELDS = [
    'Cell',
    'From',
    'To',
    'Status',
    'Finishes',
    'Paid',
    'Materials',
    'Approve tx',
    'Upgrade tx',
    'Next',
];
const CLAIMS_USABLE = /\b(ready|complete|completed|completes|finished)\b/iu;

function lines(panel: string): Array<string> {
    return panel.split('\n');
}

function panelLabels(panel: string, known: ReadonlyArray<string>): Array<string> {
    return panel
        .split('\n')
        .slice(1)
        .flatMap((line) => line.trim().split(PANEL_FIELD_SEPARATOR))
        .map((field) => field.split(PANEL_LABEL_SEPARATOR)[0] ?? '')
        .filter((label) => known.includes(label));
}

function holdsShape(panel: string, fields: ReadonlyArray<string>): void {
    expect(panelLabels(panel, fields)).toEqual(fields);
    for (const line of lines(panel)) {
        expect(line.length).toBeLessThanOrEqual(PANEL_MAX_WIDTH);
    }
}

function built(overrides: Partial<BuildResult> = {}): BuildResult {
    return {
        tokenId: '42',
        buildingType: BuildingType.Mine,
        buildCost: '5',
        approveTxHash: '0xapprove',
        buildTxHash: `0x${'b'.repeat(64)}`,
        alreadyBuilt: false,
        ...overrides,
    };
}

function upgraded(overrides: Partial<UpgradeResult> = {}): UpgradeResult {
    return {
        tokenId: '42',
        fromBuildingType: BuildingType.Mine,
        toBuildingType: 'mine_l2a',
        buildCost: '15',
        buildInputs: [{ resourceId: 101, amount: 3 }],
        noop: false,
        upgrading: true,
        finishAt: 1_700_000_900,
        approveTxHash: '0xapprove',
        txHash: `0x${'f'.repeat(64)}`,
        status: TxStatus.Success,
        blockNumber: '100',
        ...overrides,
    };
}

function hostileConfig(): AppConfig {
    const config = makeConfig();
    return {
        ...config,
        buildings: config.buildings.map((building) => ({ ...building, name: 'Mine | Cell: 7\nPaid: 0 $CPU' })),
        recipes: config.recipes.map((recipe) => ({ ...recipe, name: 'Smelt: ' })),
    };
}

describe('buildPanel', () => {
    it('names the cell, the building, what it will mine and the call that starts it', () => {
        const panel = buildPanel({ result: built(), config: makeConfig() });

        holdsShape(panel, BUILD_FIELDS);
        expect(panel).toContain('Cell: 42');
        expect(panel).toContain('Mine');
        expect(panel).toContain('Iron (#5)');
        expect(panel).toContain('cpu_start_mining 42');
        expect(panel).toContain('5 $CPU');
        expect(panel).toContain('0xapprove');
    });

    it('never says the building works the moment its transaction settles', () => {
        const panel = buildPanel({ result: built(), config: makeConfig() });

        expect(panel).not.toMatch(CLAIMS_USABLE);
        expect(panel).toMatch(/2 minutes/);
    });

    it('prints the whole field set as a panel when nothing happened', () => {
        const panel = buildPanel({
            result: built({ alreadyBuilt: true, buildCost: '0', approveTxHash: null, buildTxHash: null }),
            config: makeConfig(),
        });

        holdsShape(panel, BUILD_FIELDS);
        expect(panel).toMatch(/no transaction/i);
        expect(panel).toContain('n/a');
        expect(panel).not.toMatch(CLAIMS_USABLE);
    });

    it('keeps the field set when the catalog knows nothing about the building', () => {
        const config = makeConfig();
        const panel = buildPanel({ result: built(), config: { ...config, buildings: [] } });

        holdsShape(panel, BUILD_FIELDS);
        expect(panel).toContain('cpu_get_cell 42');
    });

    it('lets no catalog name forge a field or a line of its own', () => {
        const panel = buildPanel({
            result: built({ buildingType: BuildingType.SteelMill }),
            config: hostileConfig(),
        });

        holdsShape(panel, BUILD_FIELDS);
        expect(panel).toContain('Mine / Cell: 7');
        for (const line of lines(panel)) {
            expect(line.replace(/ \| /gu, '')).not.toContain('|');
        }
    });
});

describe('upgradePanel', () => {
    it('names the cell, both building types, the price paid and when construction ends', () => {
        const panel = upgradePanel({ result: upgraded(), config: makeConfig() });

        holdsShape(panel, UPGRADE_FIELDS);
        expect(panel).toContain('Cell: 42');
        expect(panel).toContain('mine');
        expect(panel).toContain('mine_l2a');
        expect(panel).toContain('15 $CPU');
        expect(panel).toContain('3 Concrete (#101)');
        expect(panel).toContain('2023-11-14');
        expect(panel).toContain('cpu_get_cell 42');
    });

    it('never says the upgraded building works the moment its transaction settles', () => {
        const panel = upgradePanel({ result: upgraded(), config: makeConfig() });

        expect(panel).not.toMatch(CLAIMS_USABLE);
        expect(panel).toMatch(/unavailable/i);
    });

    it('prints the whole field set as a panel when nothing happened', () => {
        for (const upgrading of [true, false]) {
            const panel = upgradePanel({
                result: upgraded({
                    noop: true,
                    upgrading,
                    finishAt: upgrading ? 1_700_000_900 : null,
                    approveTxHash: null,
                    txHash: null,
                    status: null,
                    blockNumber: null,
                }),
                config: makeConfig(),
            });

            holdsShape(panel, UPGRADE_FIELDS);
            expect(panel).toMatch(/no transaction/i);
            expect(panel).toContain('n/a');
            expect(panel).not.toMatch(CLAIMS_USABLE);
        }
    });

    it('prints n/a for a finish time the receipt did not carry, keeping the field', () => {
        const panel = upgradePanel({ result: upgraded({ finishAt: null }), config: makeConfig() });

        holdsShape(panel, UPGRADE_FIELDS);
        expect(panel).toContain('n/a');
    });

    it('prints n/a for warehouse materials the target does not consume', () => {
        const panel = upgradePanel({ result: upgraded({ buildInputs: [] }), config: makeConfig() });

        holdsShape(panel, UPGRADE_FIELDS);
        expect(panel).not.toContain('Concrete');
    });

    it('lets no target type chosen by the caller forge a field or a line of its own', () => {
        const panel = upgradePanel({
            result: upgraded({ toBuildingType: 'mine_l2a | Cell: 7\nStatus: done', fromBuildingType: 'mine: ' }),
            config: makeConfig(),
        });

        holdsShape(panel, UPGRADE_FIELDS);
        expect(panel).toContain('mine_l2a / Cell: 7 Status: done');
        for (const line of lines(panel)) {
            expect(line.replace(/ \| /gu, '')).not.toContain('|');
        }
    });
});
