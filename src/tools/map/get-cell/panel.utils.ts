import {
    CELL_OVERVIEW_FOREIGN,
    CELL_OVERVIEW_IDLE,
    CELL_OVERVIEW_LABELS,
    CELL_OVERVIEW_MINE,
    CELL_OVERVIEW_NO_BUILDING,
    CELL_OVERVIEW_NO_WALLET,
    CELL_OVERVIEW_READY,
    CELL_OVERVIEW_REVEAL_PENDING,
    CELL_OVERVIEW_STALLED,
    CELL_OVERVIEW_TITLE,
} from './constants.js';
import { demolishNote } from './demolish.utils.js';
import type { CellOverviewInput } from './types.js';
import {
    type CellBuildingView,
    CellProcessKind,
    type CellProcessView,
    type EnrichedCell,
    NeighborRelation,
} from '../../../map/types.js';
import { formatUnixSeconds, resourceLabel, type ResourceNames } from '../../../utils/format.utils.js';
import { renderPanel } from '../../../utils/panel.utils.js';

function ownership(owner: string, walletAddress: string | null): string {
    if (walletAddress === null) {
        return CELL_OVERVIEW_NO_WALLET;
    }
    return owner.toLowerCase() === walletAddress.toLowerCase() ? CELL_OVERVIEW_MINE : CELL_OVERVIEW_FOREIGN;
}

function reveals(cell: EnrichedCell): string {
    return cell.revealPending ? `${cell.revealCount} (${CELL_OVERVIEW_REVEAL_PENDING})` : `${cell.revealCount}`;
}

function building(view: CellBuildingView | null, serverTime: number): string {
    if (view === null) {
        return CELL_OVERVIEW_NO_BUILDING;
    }
    if (view.buildFinishAt !== null && view.buildFinishAt > serverTime) {
        return `${view.type} (building until ${formatUnixSeconds(view.buildFinishAt)})`;
    }
    return `${view.type} (${CELL_OVERVIEW_READY})`;
}

function job(process: CellProcessView | null, resources: ResourceNames): string {
    if (process === null) {
        return CELL_OVERVIEW_IDLE;
    }
    const running =
        process.kind === CellProcessKind.Mining
            ? `mining ${resourceLabel(resources, process.resource)}`
            : `crafting (${process.recipeId})`;
    return process.stalled ? `${running}, ${CELL_OVERVIEW_STALLED}` : running;
}

function neighbours(cell: EnrichedCell): string {
    const counted = (relation: NeighborRelation): number =>
        cell.neighbors.filter((neighbor) => neighbor.relation === relation).length;
    const owned = counted(NeighborRelation.Owned);
    const others = counted(NeighborRelation.Other);
    const empty = counted(NeighborRelation.Empty);
    return `${cell.neighbors.length} (${owned} yours, ${others} others, ${empty} empty)`;
}

export function cellOverviewPanel(input: CellOverviewInput): string {
    const labels = CELL_OVERVIEW_LABELS;
    const { cell } = input.inspection;
    const distance = input.inspection.distanceFromMine;

    return renderPanel({
        title: CELL_OVERVIEW_TITLE,
        rows: [
            [
                { label: labels.cell, value: `${cell.tokenId} (${ownership(cell.owner, input.walletAddress)})` },
                { label: labels.owner, value: cell.owner },
            ],
            [
                { label: labels.reveals, value: reveals(cell) },
                { label: labels.deposits, value: `${cell.resources.length}` },
                { label: labels.building, value: building(cell.building, input.serverTime) },
            ],
            [
                { label: labels.job, value: job(cell.process, input.resources) },
                { label: labels.nearestOwn, value: distance === null ? null : `${distance} hops` },
            ],
            [{ label: labels.neighbours, value: neighbours(cell) }],
            [{ label: labels.note, value: demolishNote(input.demolish) }],
        ],
    });
}
