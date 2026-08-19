import type { CellBuildingView, CellProjectionConfig, ProcessProjectionConfig } from './types.js';

export function configuredStorageCap(
    resourceId: number,
    useHubShelf: boolean,
    config: ProcessProjectionConfig,
): bigint | null {
    const caps = config.storageCapsByResource[resourceId];
    return caps === undefined ? null : useHubShelf ? caps.hubCap : caps.cellCap;
}

export function usesHubShelf(
    building: CellBuildingView | null,
    ready: boolean | null,
    config: CellProjectionConfig,
): boolean {
    if (building === null || !config.hubBuildingTypes.has(building.type)) {
        return false;
    }
    const upgradeFrom = config.upgradeFromByBuildingType[building.type] ?? null;
    const upgradesFromHub = upgradeFrom !== null && config.hubBuildingTypes.has(upgradeFrom);
    return ready === true || upgradesFromHub;
}
