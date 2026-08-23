import { MapReadiness, type CellProjectionConfig, type ProcessOutput, type ResourceStorageCaps } from './types.js';
import { BuildingKind } from '../api/types.js';
import type { AppConfig } from '../services/types.js';

/** True once the startup snapshot has landed: every existing cell is held, even if the stream later degrades. */
export function isBootstrapComplete(readiness: MapReadiness): boolean {
    return readiness === MapReadiness.Ready || readiness === MapReadiness.Degraded;
}

export function buildingTypesOfKind(config: AppConfig, kind: BuildingKind): Set<string> {
    return new Set(config.buildings.filter((b) => b.kind === kind).map((b) => b.type as string));
}

export function craftOutputsByRecipe(config: AppConfig): Record<string, Array<ProcessOutput>> {
    return Object.fromEntries(config.recipes.map((r): [string, Array<ProcessOutput>] => [r.id, r.outputs]));
}

export function storageCapsByResource(config: AppConfig): Record<number, ResourceStorageCaps> {
    return Object.fromEntries(
        config.storage.caps.map((caps): [number, ResourceStorageCaps] => [
            caps.resourceId,
            {
                cellCap: caps.cellCap === 0 ? null : BigInt(caps.cellCap),
                hubCap: caps.hubCap === 0 ? null : BigInt(caps.hubCap),
            },
        ]),
    );
}

export function toProjectionConfig(config: AppConfig): CellProjectionConfig {
    return {
        hubBuildingTypes: buildingTypesOfKind(config, BuildingKind.Hub),
        upgradeFromByBuildingType: Object.fromEntries(
            config.buildings.map((building) => [building.type, building.upgradeFrom]),
        ),
        craftOutputsByRecipe: craftOutputsByRecipe(config),
        storageCapsByResource: storageCapsByResource(config),
    };
}
