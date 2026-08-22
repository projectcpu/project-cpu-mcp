import {
    DEFAULT_MATCH_LIMIT,
    INDEX_COLUMNS_LEGEND,
    NO_FILTERS_LABEL,
    NO_MATCH_HINT,
    SINGLE_MATCH_NOTE,
    TRUNCATED_HINT,
} from './constants.js';
import type { BuildingIndexRowView, FindBuildingsArgs } from './types.js';
import type { RecipeView } from '../../../api/types.js';
import type { CatalogBuildingView } from '../../../services/types.js';
import { resourceLabel, type ResourceNames } from '../../../utils/format.utils.js';
import { PANEL_FIELD_SEPARATOR } from '../../../utils/panel.constants.js';
import { summarizeBuildingRole } from '../building-card/building-card.utils.js';

function recipesOf(building: CatalogBuildingView, recipes: Array<RecipeView>): Array<RecipeView> {
    return building.recipes.flatMap((id) => recipes.filter((recipe) => recipe.id === id));
}

function matchesFilters(
    building: CatalogBuildingView,
    filters: FindBuildingsArgs,
    recipes: Array<RecipeView>,
): boolean {
    const own = recipesOf(building, recipes);
    if (filters.buildInput !== null && !building.buildInputs.some((s) => s.resourceId === filters.buildInput)) {
        return false;
    }
    if (
        filters.recipeInput !== null &&
        !own.some((recipe) => recipe.inputs.some((s) => s.resourceId === filters.recipeInput))
    ) {
        return false;
    }
    if (
        filters.recipeOutput !== null &&
        !own.some((recipe) => recipe.outputs.some((s) => s.resourceId === filters.recipeOutput))
    ) {
        return false;
    }
    if (filters.minableResource !== null && !building.minableResources.includes(filters.minableResource)) {
        return false;
    }
    if (filters.kind !== null && building.kind !== filters.kind) {
        return false;
    }
    return filters.tier === null || building.tier === filters.tier;
}

export function selectBuildings(
    buildings: Array<CatalogBuildingView>,
    filters: FindBuildingsArgs,
    recipes: Array<RecipeView>,
): Array<CatalogBuildingView> {
    return buildings.filter((building) => matchesFilters(building, filters, recipes));
}

export function resultLimit(limit: number | null): number {
    return limit ?? DEFAULT_MATCH_LIMIT;
}

export function buildIndexRow(
    building: CatalogBuildingView,
    recipes: Array<RecipeView>,
    resources: ResourceNames,
): BuildingIndexRowView {
    return {
        type: building.type,
        name: building.name,
        kind: building.kind,
        tier: building.tier,
        buildCostCpu: building.buildCost,
        summary: summarizeBuildingRole(building, recipes, resources),
    };
}

export function renderIndexRow(row: BuildingIndexRowView): string {
    return [row.type, row.name, row.kind, `tier ${row.tier}`, `build ${row.buildCostCpu} $CPU`, row.summary].join(
        PANEL_FIELD_SEPARATOR,
    );
}

export function renderBuildingIndexLine(
    building: CatalogBuildingView,
    recipes: Array<RecipeView>,
    resources: ResourceNames,
): string {
    return renderIndexRow(buildIndexRow(building, recipes, resources));
}

export function describeFilters(filters: FindBuildingsArgs, resources: ResourceNames): string {
    const terms: Array<string> = [];
    if (filters.buildInput !== null) {
        terms.push(`build inputs include ${resourceLabel(resources, filters.buildInput)}`);
    }
    if (filters.recipeInput !== null) {
        terms.push(`recipe inputs include ${resourceLabel(resources, filters.recipeInput)}`);
    }
    if (filters.recipeOutput !== null) {
        terms.push(`recipe outputs include ${resourceLabel(resources, filters.recipeOutput)}`);
    }
    if (filters.minableResource !== null) {
        terms.push(`minable resources include ${resourceLabel(resources, filters.minableResource)}`);
    }
    if (filters.kind !== null) {
        terms.push(`kind ${filters.kind}`);
    }
    if (filters.tier !== null) {
        terms.push(`tier ${filters.tier}`);
    }
    return terms.length === 0 ? NO_FILTERS_LABEL : terms.join('; ');
}

export function renderNoMatch(filters: FindBuildingsArgs, resources: ResourceNames): string {
    return `No catalog building matches ${describeFilters(filters, resources)}. ${NO_MATCH_HINT}`;
}

export function renderSingleMatchHeadline(filters: FindBuildingsArgs, resources: ResourceNames): string {
    return `${SINGLE_MATCH_NOTE} Filters: ${describeFilters(filters, resources)}.`;
}

export function renderIndex(
    rows: Array<BuildingIndexRowView>,
    matchCount: number,
    filters: FindBuildingsArgs,
    resources: ResourceNames,
): string {
    const shown = rows.length === matchCount ? `${matchCount}` : `${rows.length} of ${matchCount}`;
    const headline = `${shown} catalog building(s) match ${describeFilters(filters, resources)}.`;
    const tail = rows.length === matchCount ? [] : ['', TRUNCATED_HINT];
    return [headline, INDEX_COLUMNS_LEGEND, ...rows.map(renderIndexRow), ...tail].join('\n');
}
