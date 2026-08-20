import { formatDistanceStrict } from 'date-fns';

import {
    BUILD_PANEL_LABELS,
    BUILD_PANEL_NEXT_AFTER,
    BUILD_PANEL_NEXT_CRAFT,
    BUILD_PANEL_NEXT_INSPECT,
    BUILD_PANEL_NEXT_MINE,
    BUILD_PANEL_PURPOSE_HUB,
    BUILD_PANEL_STATUS_NOOP,
    BUILD_PANEL_STATUS_STARTED,
    BUILD_PANEL_TITLE,
    UPGRADE_PANEL_LABELS,
    UPGRADE_PANEL_NEXT_INSPECT,
    UPGRADE_PANEL_STATUS_NOOP_SETTLED,
    UPGRADE_PANEL_STATUS_NOOP_UPGRADING,
    UPGRADE_PANEL_STATUS_STARTED,
    UPGRADE_PANEL_TITLE,
} from './constants.js';
import type { BuildPanelInput, UpgradePanelInput } from './types.js';
import { BuildingKind } from '../../api/types.js';
import type { AppConfig, CatalogBuildingView } from '../../services/types.js';
import { formatStacks, formatUnixSeconds, resourceLabel } from '../../utils/format.utils.js';
import { renderPanel } from '../../utils/panel.utils.js';

function recipeName(config: AppConfig, recipeId: string): string {
    const recipe = config.recipes.find((r) => r.id === recipeId);
    return recipe !== undefined ? `${recipe.name} (${recipe.id})` : recipeId;
}

function joined(parts: ReadonlyArray<string>): string | null {
    return parts.length === 0 ? null : parts.join(', ');
}

function purpose(view: CatalogBuildingView | null, config: AppConfig): string | null {
    if (view === null) {
        return null;
    }
    if (view.kind === BuildingKind.Extractor) {
        const mines = joined(view.minableResources.map((id) => resourceLabel(config.resources, id)));
        return mines === null ? null : `mines ${mines}`;
    }
    if (view.kind === BuildingKind.Crafter) {
        const crafts = joined(view.recipes.map((id) => recipeName(config, id)));
        return crafts === null ? null : `crafts ${crafts}`;
    }
    return BUILD_PANEL_PURPOSE_HUB;
}

function nextCall(view: CatalogBuildingView | null, tokenId: string): string {
    if (view?.kind === BuildingKind.Extractor) {
        return `${BUILD_PANEL_NEXT_AFTER} ${BUILD_PANEL_NEXT_MINE} ${tokenId}`;
    }
    if (view?.kind === BuildingKind.Crafter) {
        return `${BUILD_PANEL_NEXT_AFTER} ${BUILD_PANEL_NEXT_CRAFT} ${tokenId}`;
    }
    return `${BUILD_PANEL_NEXT_INSPECT} ${tokenId}`;
}

function buildWait(view: CatalogBuildingView | null, alreadyBuilt: boolean): string | null {
    if (view === null || alreadyBuilt || view.buildTimeSec <= 0) {
        return null;
    }
    return formatDistanceStrict(0, view.buildTimeSec * 1000);
}

export function buildPanel(input: BuildPanelInput): string {
    const { result, config } = input;
    const labels = BUILD_PANEL_LABELS;
    const view = config.buildings.find((building) => building.type === result.buildingType) ?? null;

    return renderPanel({
        title: BUILD_PANEL_TITLE,
        rows: [
            [
                { label: labels.cell, value: result.tokenId },
                { label: labels.building, value: view?.name ?? result.buildingType },
            ],
            [
                {
                    label: labels.status,
                    value: result.alreadyBuilt ? BUILD_PANEL_STATUS_NOOP : BUILD_PANEL_STATUS_STARTED,
                },
            ],
            [
                { label: labels.finishesIn, value: buildWait(view, result.alreadyBuilt) },
                { label: labels.paid, value: `${result.buildCost} $CPU` },
            ],
            [{ label: labels.approveTx, value: result.approveTxHash }],
            [{ label: labels.buildTx, value: result.buildTxHash }],
            [{ label: labels.purpose, value: purpose(view, config) }],
            [{ label: labels.next, value: nextCall(view, result.tokenId) }],
        ],
    });
}

function upgradeStatus(noop: boolean, upgrading: boolean): string {
    if (!noop) {
        return UPGRADE_PANEL_STATUS_STARTED;
    }
    return upgrading ? UPGRADE_PANEL_STATUS_NOOP_UPGRADING : UPGRADE_PANEL_STATUS_NOOP_SETTLED;
}

export function upgradePanel(input: UpgradePanelInput): string {
    const { result, config } = input;
    const labels = UPGRADE_PANEL_LABELS;
    const materials = formatStacks(config.resources, result.buildInputs);

    return renderPanel({
        title: UPGRADE_PANEL_TITLE,
        rows: [
            [
                { label: labels.cell, value: result.tokenId },
                { label: labels.from, value: result.fromBuildingType },
            ],
            [{ label: labels.to, value: result.toBuildingType }],
            [{ label: labels.status, value: upgradeStatus(result.noop, result.upgrading) }],
            [
                {
                    label: labels.finishes,
                    value: result.finishAt === null ? null : formatUnixSeconds(result.finishAt),
                },
                { label: labels.paid, value: `${result.buildCost} $CPU` },
            ],
            [{ label: labels.materials, value: materials }],
            [{ label: labels.approveTx, value: result.approveTxHash }],
            [{ label: labels.upgradeTx, value: result.txHash }],
            [{ label: labels.next, value: `${UPGRADE_PANEL_NEXT_INSPECT} ${result.tokenId}` }],
        ],
    });
}
