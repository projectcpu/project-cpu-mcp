import {
    BUILD_INPUT_TO_SECTION,
    CELL_SHELF_LABEL,
    EMPTY_GROUP_VALUE,
    HUB_SHELF_LABEL,
    IDLE_RESOURCE_NOTE,
    LENS_HEADLINE_TAIL,
    LENS_INDENT,
    MINED_BY_SECTION,
    PER_BUILD_LABEL,
    PER_CYCLE_LABEL,
    RECIPE_INPUT_TO_SECTION,
    RECIPE_OUTPUT_OF_SECTION,
    RUN_BY_LABEL,
    SHELVES_MISSING_NOTE,
    STORAGE_SECTION_TITLE,
    TRANSIT_FEE_FLOOR_LABEL,
    TRANSIT_FEE_FLOOR_MISSING_NOTE,
    TRANSIT_FEE_FLOOR_NOTE,
    TRANSIT_SECTION_TITLE,
    UNKNOWN_RESOURCE_NOTE,
    UNLIMITED_SHELF_CAP,
    UNLIMITED_SHELF_VALUE,
} from './constants.js';
import type { ResourceBuildingRowView, ResourceLensView, ResourceRecipeRowView } from './types.js';
import type { CraftStackView, RecipeView } from '../../../api/types.js';
import { WCPU_RESOURCE_ID } from '../../../config/constants.js';
import type { AppConfig, CatalogBuildingView } from '../../../services/types.js';
import { resourceLabel, resourceName, type ResourceNames } from '../../../utils/format.utils.js';
import { PANEL_FIELD_SEPARATOR } from '../../../utils/panel.constants.js';
import { buildIndexRow, renderIndexRow } from '../find-buildings/find-buildings.utils.js';

function stackAmount(stacks: Array<CraftStackView>, resourceId: number): number {
    return stacks.reduce((sum, stack) => (stack.resourceId === resourceId ? sum + stack.amount : sum), 0);
}

function buildingRow(
    building: CatalogBuildingView,
    amount: number | null,
    recipes: Array<RecipeView>,
    resources: ResourceNames,
): ResourceBuildingRowView {
    return { ...buildIndexRow(building, recipes, resources), amount };
}

function recipeRow(recipe: RecipeView, amount: number, buildings: Array<CatalogBuildingView>): ResourceRecipeRowView {
    return {
        id: recipe.id,
        name: recipe.name,
        amount,
        durationSec: recipe.durationSec,
        buildings: buildings
            .filter((building) => building.recipes.includes(recipe.id))
            .map((building) => building.name),
    };
}

export function buildResourceLens(resourceId: number, config: AppConfig): ResourceLensView {
    const { buildings, recipes, resources, storage, transport } = config;
    const shelves = storage.caps.find((entry) => entry.resourceId === resourceId) ?? null;

    return {
        resourceId,
        resourceName: resourceName(resources, resourceId),
        inCatalog: resources[resourceId] !== undefined,
        minedBy: buildings
            .filter((building) => building.minableResources.includes(resourceId))
            .map((building) => buildingRow(building, null, recipes, resources)),
        buildInputTo: buildings
            .filter((building) => building.buildInputs.some((stack) => stack.resourceId === resourceId))
            .map((building) =>
                buildingRow(building, stackAmount(building.buildInputs, resourceId), recipes, resources),
            ),
        recipeInputTo: recipes
            .filter((recipe) => recipe.inputs.some((stack) => stack.resourceId === resourceId))
            .map((recipe) => recipeRow(recipe, stackAmount(recipe.inputs, resourceId), buildings)),
        recipeOutputOf: recipes
            .filter((recipe) => recipe.outputs.some((stack) => stack.resourceId === resourceId))
            .map((recipe) => recipeRow(recipe, stackAmount(recipe.outputs, resourceId), buildings)),
        storage: shelves === null ? null : { cellShelf: shelves.cellCap, hubShelf: shelves.hubCap },
        transitFeeFloorCpu: transport.moveFeeFloors[resourceId] ?? null,
    };
}

function isIdle(lens: ResourceLensView): boolean {
    return (
        lens.minedBy.length === 0 &&
        lens.buildInputTo.length === 0 &&
        lens.recipeInputTo.length === 0 &&
        lens.recipeOutputOf.length === 0
    );
}

function groupLines(title: string, rows: Array<string>): Array<string> {
    const body = rows.length === 0 ? [EMPTY_GROUP_VALUE] : rows;
    return [title, ...body.map((row) => `${LENS_INDENT}${row}`)];
}

function buildingRowLine(row: ResourceBuildingRowView): string {
    const index = renderIndexRow(row);
    return row.amount === null ? index : `${index}${PANEL_FIELD_SEPARATOR}${row.amount} ${PER_BUILD_LABEL}`;
}

function recipeRowLine(row: ResourceRecipeRowView): string {
    const runners = row.buildings.length === 0 ? EMPTY_GROUP_VALUE : row.buildings.join(', ');
    return [
        `${row.name} (${row.id})`,
        `${row.amount} ${PER_CYCLE_LABEL}`,
        `${row.durationSec}s/cycle`,
        `${RUN_BY_LABEL} ${runners}`,
    ].join(PANEL_FIELD_SEPARATOR);
}

function shelfValue(resourceId: number, units: number): string {
    return resourceId === WCPU_RESOURCE_ID && units === UNLIMITED_SHELF_CAP ? UNLIMITED_SHELF_VALUE : `${units} units`;
}

function storageLines(lens: ResourceLensView): Array<string> {
    if (lens.storage === null) {
        return [STORAGE_SECTION_TITLE, `${LENS_INDENT}${SHELVES_MISSING_NOTE}`];
    }
    return [
        STORAGE_SECTION_TITLE,
        `${LENS_INDENT}${CELL_SHELF_LABEL}: ${shelfValue(lens.resourceId, lens.storage.cellShelf)}`,
        `${LENS_INDENT}${HUB_SHELF_LABEL}: ${shelfValue(lens.resourceId, lens.storage.hubShelf)}`,
    ];
}

function transitLines(lens: ResourceLensView): Array<string> {
    const value =
        lens.transitFeeFloorCpu === null
            ? TRANSIT_FEE_FLOOR_MISSING_NOTE
            : `${lens.transitFeeFloorCpu} $CPU per unit — ${TRANSIT_FEE_FLOOR_NOTE}`;
    return [TRANSIT_SECTION_TITLE, `${LENS_INDENT}${TRANSIT_FEE_FLOOR_LABEL}: ${value}`];
}

function headlineLines(lens: ResourceLensView, resources: ResourceNames): Array<string> {
    const headline = `${resourceLabel(resources, lens.resourceId)} — ${LENS_HEADLINE_TAIL}`;
    if (!lens.inCatalog) {
        return [headline, UNKNOWN_RESOURCE_NOTE];
    }
    return isIdle(lens) ? [headline, IDLE_RESOURCE_NOTE] : [headline];
}

export function renderResourceLens(lens: ResourceLensView, resources: ResourceNames): string {
    return [
        ...headlineLines(lens, resources),
        '',
        ...groupLines(MINED_BY_SECTION, lens.minedBy.map(buildingRowLine)),
        ...groupLines(BUILD_INPUT_TO_SECTION, lens.buildInputTo.map(buildingRowLine)),
        ...groupLines(RECIPE_INPUT_TO_SECTION, lens.recipeInputTo.map(recipeRowLine)),
        ...groupLines(RECIPE_OUTPUT_OF_SECTION, lens.recipeOutputOf.map(recipeRowLine)),
        '',
        ...storageLines(lens),
        '',
        ...transitLines(lens),
    ].join('\n');
}
