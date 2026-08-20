import {
    BUILDING_INDEX_SECTION_TITLE,
    EMPTY_CATALOG_NOTE,
    ENTRY_POINT_HEADLINE_TAIL,
    ENTRY_POINT_LOOKUP,
    NONE_LABEL,
    PUSH_RANDOMNESS_SUMMARY,
    REVEAL_PAYMENT_UNKNOWN_SUMMARY,
    ROUTING_BUILDING_CARD_LINE,
    ROUTING_FIND_BUILDINGS_LINE,
    ROUTING_RECIPES_LINE,
    ROUTING_RESOURCE_LENS_LINE,
    ROUTING_SECTION_TITLE,
    ROUTING_UNKNOWN_ID_LINE,
    SALE_FEE_STRUCTURAL_BOUND_PERCENT,
    SELF_SERVICE_RANDOMNESS_SUMMARY,
    STATIC_SECTION_TITLE,
    STORAGE_SHELVES_SUMMARY,
    TRANSIT_FEE_FLOOR_SUMMARY,
} from './constants.js';
import type { GameConfigReferenceView } from './types.js';
import { type RandomnessDescriptor, RandomnessKind, type RevealPaymentView } from '../../../api/types.js';
import type { AppConfig } from '../../../services/types.js';
import { INDEX_COLUMNS_LEGEND } from '../find-buildings/constants.js';
import { renderBuildingIndexLine } from '../find-buildings/find-buildings.utils.js';

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

function renderPairs(entries: Array<[string, string]>): string {
    return entries.length > 0 ? entries.map(([key, value]) => `${key}:${value}`).join(', ') : NONE_LABEL;
}

function describeTransit(config: AppConfig): string {
    const floors = renderPairs(Object.entries(config.transport.moveFeeFloors));
    return (
        `radii in cells — move ${config.transport.moveRadius}, hub ${config.transport.hubRadius}; ` +
        `${config.transport.moveTimePerCellSec}s per cell; ${TRANSIT_FEE_FLOOR_SUMMARY} — ${floors}`
    );
}

function describeTrade(config: AppConfig): string {
    return (
        `${config.trade.saleBurnPercent}% sale burn, sale fee up to ${SALE_FEE_STRUCTURAL_BOUND_PERCENT}% ` +
        '(the structural bound — a hub owner can set any rate up to this maximum)'
    );
}

export function renderHeadline(config: AppConfig): string {
    return (
        `Network ${config.network} (chainId ${config.chainId}), ${config.buildings.length} building(s), ` +
        `${config.recipes.length} recipe(s). ${ENTRY_POINT_HEADLINE_TAIL}`
    );
}

export function renderRoutingMap(): string {
    return [
        ROUTING_SECTION_TITLE,
        ROUTING_BUILDING_CARD_LINE,
        ROUTING_FIND_BUILDINGS_LINE,
        ROUTING_RESOURCE_LENS_LINE,
        ROUTING_RECIPES_LINE,
        ROUTING_UNKNOWN_ID_LINE,
    ].join('\n');
}

export function renderStaticFacts(config: AppConfig): string {
    return [
        STATIC_SECTION_TITLE,
        `Reveal: ${describeRevealPayment(config.reveal)}.`,
        `Randomness: ${describeRandomnessMode(config.randomness)}`,
        `Trade: ${describeTrade(config)}.`,
        `Transit: ${describeTransit(config)}.`,
        `Storage: ${STORAGE_SHELVES_SUMMARY}.`,
        `Resources: ${renderPairs(Object.entries(config.resources))}.`,
        `Contracts — land ${config.contracts.land}, $CPU ${config.contracts.cpuToken}, ` +
            `cpuHook ${config.contracts.cpuHook}, cell ${config.contracts.cell}, ` +
            `transport ${config.contracts.transport}.`,
    ].join('\n');
}

export function renderBuildingIndex(config: AppConfig): string {
    const heading = `${BUILDING_INDEX_SECTION_TITLE} (${config.buildings.length} building(s)). ${INDEX_COLUMNS_LEGEND}`;
    if (config.buildings.length === 0) {
        return `${heading}\n${EMPTY_CATALOG_NOTE}`;
    }
    const rows = config.buildings.map((building) =>
        renderBuildingIndexLine(building, config.recipes, config.resources),
    );
    return [heading, ...rows].join('\n');
}

export function renderEntryPoint(config: AppConfig): string {
    return [renderHeadline(config), renderRoutingMap(), renderStaticFacts(config), renderBuildingIndex(config)].join(
        '\n\n',
    );
}

export function buildGameConfigReference(config: AppConfig): GameConfigReferenceView {
    return {
        network: config.network,
        chainId: config.chainId,
        contracts: config.contracts,
        randomness: config.randomness,
        resources: config.resources,
        reveal: config.reveal,
        transport: config.transport,
        trade: config.trade,
        storage: config.storage,
        catalog: { buildingCount: config.buildings.length, recipeCount: config.recipes.length },
        lookup: {
            building: ENTRY_POINT_LOOKUP.building,
            buildingSearch: ENTRY_POINT_LOOKUP.buildingSearch,
            resource: ENTRY_POINT_LOOKUP.resource,
            recipes: ENTRY_POINT_LOOKUP.recipes,
        },
    };
}
