import {
    BASE_BUILDING_PREDECESSOR_LABEL,
    CYCLE_TIME_MODIFIER_NOTE,
    EXTRACTOR_COMPATIBILITY_NOTE,
    NO_RECIPES_CONFIGURED_NOTE,
    NO_UPGRADE_PARTICIPANTS_NOTE,
    PUSH_RANDOMNESS_SUMMARY,
    SELF_SERVICE_RANDOMNESS_SUMMARY,
    TERMINAL_UPGRADE_SUCCESSOR_LABEL,
} from './constants.js';
import {
    BuildingKind,
    type CraftStackView,
    type RandomnessDescriptor,
    RandomnessKind,
    type RecipeView,
} from '../../../api/types.js';
import type { CatalogBuildingView } from '../../../services/types.js';
import { formatStacks, resourceLabel, type ResourceNames } from '../../../utils/format.utils.js';

export function describeRandomnessMode(randomness: RandomnessDescriptor): string {
    return randomness.kind === RandomnessKind.DRAND ? SELF_SERVICE_RANDOMNESS_SUMMARY : PUSH_RANDOMNESS_SUMMARY;
}

export function summarizeRecipeLines(recipes: Array<RecipeView>): string {
    if (recipes.length === 0) {
        return NO_RECIPES_CONFIGURED_NOTE;
    }
    return recipes.map(formatRecipeLine).join('\n');
}

function formatRecipeLine(recipe: RecipeView): string {
    return (
        `${recipe.id} | ${recipe.durationSec}s/cycle | in ${formatRecipeStacks(recipe.inputs)} | ` +
        `out ${formatRecipeStacks(recipe.outputs)} | ${recipe.costCpu} $CPU/cycle`
    );
}

function formatRecipeStacks(stacks: Array<CraftStackView>): string {
    return stacks.length > 0 ? stacks.map((stack) => `${stack.resourceId}:${stack.amount}`).join('+') : 'none';
}

export function summarizeUpgradeGraph(buildings: Array<CatalogBuildingView>, resources: ResourceNames): string {
    const participants = buildings.filter(isUpgradeParticipant).sort(compareUpgradeParticipants);
    if (participants.length === 0) {
        return NO_UPGRADE_PARTICIPANTS_NOTE;
    }
    return participants.map((building) => formatUpgradeParticipantLine(building, resources)).join('\n');
}

function isUpgradeParticipant(building: CatalogBuildingView): boolean {
    return building.upgradeFrom !== null || building.upgradeTo.length > 0;
}

function compareUpgradeParticipants(a: CatalogBuildingView, b: CatalogBuildingView): number {
    const byFamily = compareNullableStrings(a.family, b.family);
    if (byFamily !== 0) {
        return byFamily;
    }
    const byLevel = compareNullableNumbers(a.level, b.level);
    if (byLevel !== 0) {
        return byLevel;
    }
    return a.type.localeCompare(b.type);
}

function compareNullableStrings(a: string | null, b: string | null): number {
    if (a === b) {
        return 0;
    }
    if (a === null) {
        return 1;
    }
    if (b === null) {
        return -1;
    }
    return a.localeCompare(b);
}

function compareNullableNumbers(a: number | null, b: number | null): number {
    if (a === b) {
        return 0;
    }
    if (a === null) {
        return 1;
    }
    if (b === null) {
        return -1;
    }
    return a - b;
}

function formatUpgradeParticipantLine(building: CatalogBuildingView, resources: ResourceNames): string {
    const level = building.level !== null ? String(building.level) : 'unknown';
    const branch = building.branch ?? 'none';
    const predecessor = building.upgradeFrom ?? BASE_BUILDING_PREDECESSOR_LABEL;
    const successors = building.upgradeTo.length > 0 ? building.upgradeTo.join(',') : TERMINAL_UPGRADE_SUCCESSOR_LABEL;
    const inputs = building.buildInputs.length > 0 ? formatStacks(resources, building.buildInputs, ',') : 'none';
    return (
        `${building.type} | level ${level} | branch ${branch} | predecessor ${predecessor} | ` +
        `successors ${successors} | cost ${building.buildCost} $CPU | inputs ${inputs} | ` +
        `build ${building.buildTimeSec}s | effects ${formatUpgradeEffects(building, resources)}`
    );
}

function formatUpgradeEffects(building: CatalogBuildingView, resources: ResourceNames): string {
    const inputEfficiency =
        building.effects.inputEfficiency.length > 0
            ? building.effects.inputEfficiency
                  .map((entry) => `${resourceLabel(resources, entry.resourceId)}:${entry.percent}%`)
                  .join(',')
            : 'none';
    return (
        `cycleTimeBp ${building.effects.cycleTimeBp} (${CYCLE_TIME_MODIFIER_NOTE}), ` +
        `extractionShareBp ${building.effects.extractionShareBp}, inputEfficiency ${inputEfficiency}` +
        formatExtractorCompatibilityNote(building, resources)
    );
}

function formatExtractorCompatibilityNote(building: CatalogBuildingView, resources: ResourceNames): string {
    if (building.kind !== BuildingKind.Extractor || building.minableResources.length === 0) {
        return '';
    }
    const compatible = building.minableResources.map((id) => resourceLabel(resources, id)).join(',');
    return `, extractor-compatible ${compatible} (${EXTRACTOR_COMPATIBILITY_NOTE})`;
}
