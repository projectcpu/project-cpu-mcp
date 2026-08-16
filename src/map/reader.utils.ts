import type { CellProjectionConfig, ProcessOutput } from './types.js';
import { BuildingKind } from '../api/types.js';
import type { AppConfig } from '../services/types.js';

export function buildingTypesOfKind(config: AppConfig, kind: BuildingKind): Set<string> {
    return new Set(config.buildings.filter((b) => b.kind === kind).map((b) => b.type as string));
}

export function craftOutputsByRecipe(config: AppConfig): Record<string, Array<ProcessOutput>> {
    return Object.fromEntries(config.recipes.map((r): [string, Array<ProcessOutput>] => [r.id, r.outputs]));
}

export function extractionShareBpByBuilding(config: AppConfig): Record<string, number> {
    return Object.fromEntries(config.buildings.map((b): [string, number] => [b.type, b.effects.extractionShareBp]));
}

export function toProjectionConfig(config: AppConfig): CellProjectionConfig {
    return {
        hubBuildingTypes: buildingTypesOfKind(config, BuildingKind.Hub),
        upgradeFromByBuildingType: Object.fromEntries(
            config.buildings.map((building) => [building.type, building.upgradeFrom]),
        ),
        craftOutputsByRecipe: craftOutputsByRecipe(config),
        extractionShareBpByBuilding: extractionShareBpByBuilding(config),
    };
}
