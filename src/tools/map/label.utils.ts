import { buildingMode, outputsFor } from '../../map/mode.utils.js';
import { CellProcessKind, type CellProcessView, type CellResource, type Cell } from '../../map/types.js';
import type { CatalogBuildingView, CellOutputView } from '../../services/types.js';
import { resourceName, type ResourceNames } from '../../utils/format.utils.js';

type LabeledResource = CellResource & { resourceName: string };

function labelResource(resources: ResourceNames, resource: CellResource): LabeledResource {
    return { ...resource, resourceName: resourceName(resources, resource.resourceId) };
}

function labelProcess(resources: ResourceNames, process: CellProcessView | null) {
    if (process === null) {
        return null;
    }
    if (process.kind === CellProcessKind.Mining) {
        return { ...process, resourceName: resourceName(resources, process.resource) };
    }
    return process;
}

export function labelCell<T extends Cell>(cell: T, resources: ResourceNames) {
    return {
        ...cell,
        resources: cell.resources.map((resource) => labelResource(resources, resource)),
        process: labelProcess(resources, cell.process),
    };
}

// Map-derived and advisory: the paid start paths re-price against the chain before they send.
export function priceOutputs<T extends Cell>(
    cell: T,
    buildings: Array<CatalogBuildingView>,
    resources: ResourceNames,
): Array<CellOutputView> | null {
    if (cell.building === null) {
        return null;
    }
    const view = buildings.find((b) => b.type === cell.building?.type) ?? null;
    if (view === null) {
        return null;
    }
    return outputsFor(view, buildingMode(cell.building), resources);
}
