import { parseEther } from 'viem';

import {
    BUILD_INPUTS_LABEL,
    CARD_INDENT,
    CONSTRUCTION_SECTION_TITLE,
    EXTRACTOR_NO_INPUT_RESOURCES_NOTE,
    FREE_CYCLE_VALUE,
    HUB_OPERATION_NOTE,
    LIFECYCLE_SECTION_TITLE,
    MINABLE_RESOURCES_LABEL,
    MODE_SWITCH_IMPOSSIBLE_NOTE,
    MODE_SWITCH_UNKNOWN_NOTE,
    NO_BUILD_INPUTS_VALUE,
    NO_MINABLE_RESOURCES_NOTE,
    NO_UPGRADE_PREDECESSOR_VALUE,
    NO_UPGRADE_SUCCESSOR_VALUE,
    OPERATION_SECTION_TITLE,
    RECIPE_DETAILS_MISSING_NOTE,
    RECIPE_INPUTS_LABEL,
    RECIPE_OUTPUTS_LABEL,
    RECIPE_PLAN_INDENT,
    UNKNOWN_BUILDING_TYPE_HINT,
    UNPRICED_OPEX_NOTE,
} from './constants.js';
import type { BuildingCardView, BuildingRecipePlanView, LabeledResourceView, LabeledStackView } from './types.js';
import { BuildingKind, type CraftStackView, type RecipeView } from '../../../api/types.js';
import { type CatalogBuildingView, ModeSwitchKind } from '../../../services/types.js';
import {
    bpToPercent,
    cpuFromWei,
    resourceLabel,
    resourceName,
    type ResourceNames,
} from '../../../utils/format.utils.js';

const EXAMPLE_TYPE_COUNT = 3;

function sumCpu(base: string, opex: string): string {
    return cpuFromWei((parseEther(base) + parseEther(opex)).toString());
}

function isZeroCpu(amount: string): boolean {
    return parseEther(amount) === 0n;
}

function normalizeType(type: string): string {
    return type.trim().toLowerCase();
}

export function findBuilding(buildings: Array<CatalogBuildingView>, type: string): CatalogBuildingView | null {
    const wanted = normalizeType(type);
    return buildings.find((building) => normalizeType(building.type) === wanted) ?? null;
}

export function unknownBuildingTypeError(buildings: Array<CatalogBuildingView>, type: string): Error {
    const examples = buildings
        .slice(0, EXAMPLE_TYPE_COUNT)
        .map((building) => building.type)
        .join(', ');
    const known = examples === '' ? '' : ` Catalog types look like: ${examples}.`;
    return new Error(
        `No building of type "${type}" in the catalog of the loaded config.${known} ` +
            `${UNKNOWN_BUILDING_TYPE_HINT}.`,
    );
}

function labelStacks(stacks: Array<CraftStackView>, resources: ResourceNames): Array<LabeledStackView> {
    return stacks.map((stack) => ({
        resourceId: stack.resourceId,
        resourceName: resourceName(resources, stack.resourceId),
        amount: stack.amount,
    }));
}

function labelResources(ids: Array<number>, resources: ResourceNames): Array<LabeledResourceView> {
    return ids.map((resourceId) => ({ resourceId, resourceName: resourceName(resources, resourceId) }));
}

function recipePlan(
    id: string,
    building: CatalogBuildingView,
    recipes: Array<RecipeView>,
    resources: ResourceNames,
): BuildingRecipePlanView {
    const recipe = recipes.find((candidate) => candidate.id === id) ?? null;
    const costCpu = recipe?.costCpu ?? null;
    const opexCpu = building.recipeOpexCpu?.[id] ?? null;
    return {
        id,
        name: recipe?.name ?? null,
        durationSec: recipe?.durationSec ?? null,
        costCpu,
        opexCpu,
        totalCpu: costCpu === null || opexCpu === null ? null : sumCpu(costCpu, opexCpu),
        recipeInputs: recipe === null ? [] : labelStacks(recipe.inputs, resources),
        recipeOutputs: recipe === null ? [] : labelStacks(recipe.outputs, resources),
    };
}

export function summarizeBuildingRole(
    building: CatalogBuildingView,
    recipes: Array<RecipeView>,
    resources: ResourceNames,
): string {
    if (building.kind === BuildingKind.Hub) {
        return 'routes transport and settles trade on its cell';
    }
    if (building.kind === BuildingKind.Extractor) {
        const mined = building.minableResources.map((id) => resourceName(resources, id)).join(', ');
        return mined === '' ? 'mines nothing' : `mines ${mined}`;
    }
    const produced = [
        ...new Set(
            building.recipes.flatMap((id) =>
                (recipes.find((recipe) => recipe.id === id)?.outputs ?? []).map((stack) =>
                    resourceName(resources, stack.resourceId),
                ),
            ),
        ),
    ].join(', ');
    return produced === '' ? `runs ${building.recipes.length} recipe(s)` : `crafts ${produced}`;
}

export function buildBuildingCard(
    building: CatalogBuildingView,
    recipes: Array<RecipeView>,
    resources: ResourceNames,
): BuildingCardView {
    return {
        type: building.type,
        name: building.name,
        kind: building.kind,
        tier: building.tier,
        summary: summarizeBuildingRole(building, recipes, resources),
        construction: {
            costCpu: building.buildCost,
            buildTimeSec: building.buildTimeSec,
            buildInputs: labelStacks(building.buildInputs, resources),
        },
        operation: {
            kind: building.kind,
            recipes: building.recipes.map((id) => recipePlan(id, building, recipes, resources)),
            minableResources: labelResources(building.minableResources, resources),
            consumesRecipeInputs: building.kind === BuildingKind.Crafter,
            effects: {
                cycleTimePercent: bpToPercent(building.effects.cycleTimeBp),
                extractionSharePercent: bpToPercent(building.effects.extractionShareBp),
                recipeInputEfficiency: building.effects.inputEfficiency.map((entry) => ({
                    resourceId: entry.resourceId,
                    resourceName: resourceName(resources, entry.resourceId),
                    percent: entry.percent,
                })),
            },
        },
        lifecycle: {
            demolish: {
                costCpu: building.demolishCost.cpu,
                inputs: labelStacks(building.demolishCost.inputs, resources),
            },
            modeSwitch: building.modeSwitch,
            upgradeFrom: building.upgradeFrom,
            upgradeTo: building.upgradeTo,
        },
    };
}

function stackList(stacks: Array<LabeledStackView>, resources: ResourceNames): string {
    return stacks.map((stack) => `${stack.amount} ${resourceLabel(resources, stack.resourceId)}`).join(', ');
}

function resourceList(entries: Array<LabeledResourceView>, resources: ResourceNames): string {
    return entries.map((entry) => resourceLabel(resources, entry.resourceId)).join(', ');
}

function line(label: string, value: string, indent = CARD_INDENT): string {
    return `${indent}${label}: ${value}`;
}

function constructionLines(card: BuildingCardView, resources: ResourceNames): Array<string> {
    const inputs = card.construction.buildInputs;
    return [
        line('Cost', `${card.construction.costCpu} $CPU`),
        line('Build time', `${card.construction.buildTimeSec}s`),
        line(
            BUILD_INPUTS_LABEL,
            inputs.length === 0 ? NO_BUILD_INPUTS_VALUE : `${stackList(inputs, resources)}, burned once`,
        ),
    ];
}

function cycleCost(plan: BuildingRecipePlanView): string {
    if (plan.costCpu === null) {
        return RECIPE_DETAILS_MISSING_NOTE;
    }
    if (plan.opexCpu === null) {
        return `${plan.costCpu} $CPU base, ${UNPRICED_OPEX_NOTE}`;
    }
    if (isZeroCpu(plan.opexCpu)) {
        return isZeroCpu(plan.costCpu) ? FREE_CYCLE_VALUE : `${plan.costCpu} $CPU/cycle`;
    }
    return `${plan.costCpu} $CPU base + ${plan.opexCpu} $CPU opex = ${plan.totalCpu} $CPU/cycle`;
}

function recipeLines(plan: BuildingRecipePlanView, resources: ResourceNames): Array<string> {
    const name = plan.name === null ? '' : ` (${plan.name})`;
    const terms =
        plan.durationSec === null ? RECIPE_DETAILS_MISSING_NOTE : `${plan.durationSec}s/cycle, ${cycleCost(plan)}`;
    return [
        `${CARD_INDENT}${plan.id}${name} — ${terms}`,
        line(RECIPE_INPUTS_LABEL, stackList(plan.recipeInputs, resources), RECIPE_PLAN_INDENT),
        line(RECIPE_OUTPUTS_LABEL, stackList(plan.recipeOutputs, resources), RECIPE_PLAN_INDENT),
    ].filter((text) => !text.endsWith(': '));
}

function effectLines(card: BuildingCardView, resources: ResourceNames): Array<string> {
    const { effects } = card.operation;
    const lines = [line('Cycle time', `${effects.cycleTimePercent}% of the base cycle`)];
    if (card.kind === BuildingKind.Extractor) {
        lines.push(
            line('Extraction share', `${effects.extractionSharePercent}% of the take credited to the warehouse`),
        );
    }
    if (effects.recipeInputEfficiency.length > 0) {
        const efficiency = effects.recipeInputEfficiency
            .map((entry) => `${resourceLabel(resources, entry.resourceId)} ${entry.percent}%`)
            .join(', ');
        lines.push(line('Recipe input efficiency', efficiency));
    }
    return lines;
}

function operationLines(card: BuildingCardView, resources: ResourceNames): Array<string> {
    const { minableResources, recipes } = card.operation;
    if (card.kind === BuildingKind.Hub) {
        return [`${CARD_INDENT}${HUB_OPERATION_NOTE}`];
    }
    if (card.kind === BuildingKind.Extractor) {
        return [
            line(
                MINABLE_RESOURCES_LABEL,
                minableResources.length === 0 ? NO_MINABLE_RESOURCES_NOTE : resourceList(minableResources, resources),
            ),
            `${CARD_INDENT}${EXTRACTOR_NO_INPUT_RESOURCES_NOTE}`,
            ...effectLines(card, resources),
        ];
    }
    return [...recipes.flatMap((plan) => recipeLines(plan, resources)), ...effectLines(card, resources)];
}

function modeSwitchValue(card: BuildingCardView): string {
    switch (card.lifecycle.modeSwitch.kind) {
        case ModeSwitchKind.Possible:
            return `${card.lifecycle.modeSwitch.costCpu} $CPU to re-point it at another output`;
        case ModeSwitchKind.Impossible:
            return MODE_SWITCH_IMPOSSIBLE_NOTE;
        case ModeSwitchKind.Unknown:
            return MODE_SWITCH_UNKNOWN_NOTE;
    }
}

function lifecycleLines(card: BuildingCardView, resources: ResourceNames): Array<string> {
    const { demolish, upgradeFrom, upgradeTo } = card.lifecycle;
    const fromWarehouse = demolish.inputs.length === 0 ? '' : ` + ${stackList(demolish.inputs, resources)}`;
    return [
        line('Demolish', `${demolish.costCpu} $CPU${fromWarehouse}, no refund`),
        line('Mode switch', modeSwitchValue(card)),
        line('Upgrades from', upgradeFrom ?? NO_UPGRADE_PREDECESSOR_VALUE),
        line('Upgrades to', upgradeTo.length === 0 ? NO_UPGRADE_SUCCESSOR_VALUE : upgradeTo.join(', ')),
    ];
}

export function renderBuildingCard(card: BuildingCardView, resources: ResourceNames): string {
    return [
        `${card.name} (${card.type}) — ${card.kind}, tier ${card.tier}; ${card.summary}.`,
        '',
        CONSTRUCTION_SECTION_TITLE,
        ...constructionLines(card, resources),
        '',
        OPERATION_SECTION_TITLE,
        ...operationLines(card, resources),
        '',
        LIFECYCLE_SECTION_TITLE,
        ...lifecycleLines(card, resources),
    ].join('\n');
}
