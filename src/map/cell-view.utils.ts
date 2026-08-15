import { processOutputs } from './process.utils.js';
import { isProcessStalled } from './storage.utils.js';
import {
    type Cell,
    type CellProcessView,
    type CellProjectionConfig,
    type CellResource,
    type CellResourceStorage,
    type RawCell,
    type RawCellProcessView,
    type RawCellResource,
    type RawCellResourceStorage,
    type UnderivedCell,
} from './types.js';

function cellReady(cell: RawCell, serverTime: number): boolean | null {
    const building = cell.building;
    if (building === null) {
        return null;
    }
    return building.buildFinishAt === null || serverTime >= building.buildFinishAt;
}

function deriveStorage(storage: RawCellResourceStorage | null, useHubShelf: boolean): CellResourceStorage | null {
    if (storage === null) {
        return null;
    }
    const { cellCap, hubCap, ...occupancy } = storage;
    const cap = useHubShelf ? hubCap : cellCap;
    if (cap === null) {
        return { ...occupancy, cap: null, full: false };
    }
    return { ...occupancy, cap, full: BigInt(storage.used) >= BigInt(cap) };
}

function deriveResource(resource: RawCellResource, useHubShelf: boolean): CellResource {
    return { ...resource, storage: deriveStorage(resource.storage, useHubShelf) };
}

function deriveProcess(
    process: RawCellProcessView | null,
    resources: Array<CellResource>,
    config: CellProjectionConfig,
): CellProcessView | null {
    if (process === null) {
        return null;
    }
    const stalled = isProcessStalled(processOutputs(process, config.craftOutputsByRecipe), resources);
    return { ...process, stalled };
}

export function toCell(raw: UnderivedCell, serverTime: number, config: CellProjectionConfig): Cell {
    const ready = cellReady(raw, serverTime);
    const buildingType = raw.building?.type ?? null;
    const isHub = buildingType !== null && config.hubBuildingTypes.has(buildingType);
    const upgradeFrom = buildingType === null ? null : (config.upgradeFromByBuildingType[buildingType] ?? null);
    const upgradesFromHub = upgradeFrom !== null && config.hubBuildingTypes.has(upgradeFrom);
    const activeHub = ready === true && isHub;
    const useHubShelf = isHub && (ready === true || upgradesFromHub);
    const resources = raw.resources.map((resource) => deriveResource(resource, useHubShelf));

    return { ...raw, resources, process: deriveProcess(raw.process, resources, config), ready, activeHub };
}
