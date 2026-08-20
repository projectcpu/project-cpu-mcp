import {
    WAREHOUSE_PRESSURE_LABELS,
    WAREHOUSE_PRESSURE_NO_OWNER_NOTE,
    WAREHOUSE_PRESSURE_SCOPE_SCOUTING,
    WAREHOUSE_PRESSURE_SCOPE_SELF,
    WAREHOUSE_PRESSURE_TITLE,
} from './constants.js';
import type { WarehousePressureInput } from './types.js';
import { type AttentionItem, AttentionReason, AttentionSeverity } from '../../../map/types.js';
import { resourceLabel, type ResourceNames } from '../../../utils/format.utils.js';
import { renderPanel } from '../../../utils/panel.utils.js';

const STALLED_REASONS: ReadonlyArray<AttentionReason> = [AttentionReason.StalledMining, AttentionReason.StalledCraft];

function countReasons(items: ReadonlyArray<AttentionItem>, reasons: ReadonlyArray<AttentionReason>): number {
    return items.filter((item) => reasons.includes(item.reason)).length;
}

function peakFill(items: ReadonlyArray<AttentionItem>, resources: ResourceNames): string | null {
    let percent: number | null = null;
    let resourceId: number | null = null;
    for (const item of items) {
        if (item.fillPct === null) {
            continue;
        }
        if (percent === null || item.fillPct > percent) {
            percent = item.fillPct;
            resourceId = item.resourceId;
        }
    }
    if (percent === null) {
        return null;
    }
    const share = `${Math.round(percent)}%`;
    return resourceId === null ? share : `${share} ${resourceLabel(resources, resourceId)}`;
}

export function warehousePressurePanel(input: WarehousePressureInput): string {
    const labels = WAREHOUSE_PRESSURE_LABELS;
    return renderPanel({
        title: WAREHOUSE_PRESSURE_TITLE,
        rows: [
            [
                {
                    label: labels.scope,
                    value: input.scouting ? WAREHOUSE_PRESSURE_SCOPE_SCOUTING : WAREHOUSE_PRESSURE_SCOPE_SELF,
                },
                { label: labels.owner, value: input.owner },
            ],
            [
                { label: labels.map, value: `v${input.version}` },
                { label: labels.shown, value: `${input.items.length}` },
                { label: labels.critical, value: `${input.counts[AttentionSeverity.Critical]}` },
                { label: labels.warning, value: `${input.counts[AttentionSeverity.Warning]}` },
                { label: labels.info, value: `${input.counts[AttentionSeverity.Info]}` },
            ],
            [
                {
                    label: labels.nearFull,
                    value: `${countReasons(input.items, [AttentionReason.WarehouseNearFull])}`,
                },
                { label: labels.peakFill, value: peakFill(input.items, input.resources) },
                { label: labels.stalled, value: `${countReasons(input.items, STALLED_REASONS)}` },
            ],
            [{ label: labels.note, value: input.ownerKnown ? input.note : WAREHOUSE_PRESSURE_NO_OWNER_NOTE }],
        ],
    });
}
