import {
    BASE_BUILDING_PREDECESSOR_LABEL,
    CYCLE_TIME_MODIFIER_NOTE,
    EXTRACTOR_COMPATIBILITY_NOTE,
    NO_RECIPES_CONFIGURED_NOTE,
    NO_UPGRADE_PARTICIPANTS_NOTE,
    NONE_LABEL,
    PUSH_RANDOMNESS_SUMMARY,
    REVEAL_PAYMENT_UNKNOWN_SUMMARY,
    SELF_SERVICE_RANDOMNESS_SUMMARY,
    TERMINAL_UPGRADE_SUCCESSOR_LABEL,
    UNKNOWN_LABEL,
} from './constants.js';
import {
    BuildingKind,
    type CraftStackView,
    type RandomnessDescriptor,
    RandomnessKind,
    type RecipeView,
    type RevealPaymentView,
} from '../../../api/types.js';
import type { CatalogBuildingView } from '../../../services/types.js';
import { formatStacks, resourceLabel, type ResourceNames } from '../../../utils/format.utils.js';

export function describeRandomnessMode(randomness: RandomnessDescriptor): string {
    return randomness.kind === RandomnessKind.DRAND ? SELF_SERVICE_RANDOMNESS_SUMMARY : PUSH_RANDOMNESS_SUMMARY;
}

export function describeRevealPayment(payment: RevealPaymentView | null): string {
    if (payment === null) {
        return REVEAL_PAYMENT_UNKNOWN_SUMMARY;
    }
    return (
        `every reveal contributes ${payment.ethContribution} ETH to the $CPU liquidity ` +
        `pool and burns ${payment.cpuBurn} $CPU, the first reveal of a cell included; ` +
        `cpu_reveal reads the exact total off the chain and pays that`
    );
}

export function summarizeRecipeLines(recipes: Array<RecipeView>, resources: ResourceNames): string {
    if (recipes.length === 0) {
        return NO_RECIPES_CONFIGURED_NOTE;
    }
    return recipes.map((recipe) => formatRecipeLine(recipe, resources)).join('\n');
}

function formatRecipeLine(recipe: RecipeView, resources: ResourceNames): string {
    return (
        `${recipe.id} | ${recipe.durationSec}s/cycle | in ${formatRecipeStacks(recipe.inputs, resources)} | ` +
        `out ${formatRecipeStacks(recipe.outputs, resources)} | ${recipe.costCpu} $CPU/cycle`
    );
}

function formatRecipeStacks(stacks: Array<CraftStackView>, resources: ResourceNames): string {
    return stacks.length > 0 ? formatStacks(resources, stacks, '+') : NONE_LABEL;
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
    const level = building.level !== null ? String(building.level) : UNKNOWN_LABEL;
    const branch = building.branch ?? NONE_LABEL;
    const predecessor = building.upgradeFrom ?? BASE_BUILDING_PREDECESSOR_LABEL;
    const successors = building.upgradeTo.length > 0 ? building.upgradeTo.join(',') : TERMINAL_UPGRADE_SUCCESSOR_LABEL;
    const inputs = building.buildInputs.length > 0 ? formatStacks(resources, building.buildInputs, ',') : NONE_LABEL;
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
            : NONE_LABEL;
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
