export const SALE_FEE_STRUCTURAL_BOUND_PERCENT = 100;

export const SALE_FEE_STRUCTURAL_BOUND_NOTE =
    '(the structural bound — a hub owner can set any rate up to this maximum)';

export const LOT_LISTING_LABEL = 'Lot listing:';

export const EFFECTIVE_BOUNDS_SOURCE_NOTE = [
    'the exact unit window for one hub and one resource is read from the Trade contract itself, never worked',
    'out from these shares',
].join(' ');

export const LOT_LISTING_UNAVAILABLE_NOTE = [
    'the listing window and the per-seller lot limit live on the Trade contract and could not be read right',
    'now (no wallet configured, or the chain is unreachable) — retry once a session exists rather than',
    'assuming a bound',
].join(' ');

export const ENTRY_POINT_LOOKUP = {
    building: 'cpu_get_building',
    buildingSearch: 'cpu_find_buildings',
    resource: 'cpu_get_resource',
    recipes: 'cpu_list_recipes',
};

export const GET_GAME_CONFIG_DESCRIPTION = [
    'The entry point of the rulebook: the static facts of the active network, read once — resource catalog',
    '(id → name), contract addresses, storage shelves, transport parameters and transit-fee floors, reveal',
    'cost, how this network delivers randomness (it decides what `cpu_reveal` does), trade parameters — plus a',
    'building index (one row per building: `type`, name, kind, tier, build cost, one line of what it does).',
    `Detail is not duplicated here: \`${ENTRY_POINT_LOOKUP.building}\` for one building in full with its upgrade`,
    `links, \`${ENTRY_POINT_LOOKUP.buildingSearch}\` to search by what a building consumes, produces or mines,`,
    `\`${ENTRY_POINT_LOOKUP.resource}\` for everything about one resource, \`${ENTRY_POINT_LOOKUP.recipes}\` for`,
    'the recipes. Read-only. No session needed.',
].join(' ');

export const ENTRY_POINT_HEADLINE_TAIL =
    'Start here: the static below, an index of every building, and where to go for anything deeper.';

export const ROUTING_SECTION_TITLE = 'Where to go for detail:';

export const ROUTING_BUILDING_CARD_LINE = [
    `- One building in full — \`${ENTRY_POINT_LOOKUP.building}\` with the \`type\` from the index below:`,
    'construction, operation, lifecycle, and the upgrade links in both directions, which live on the card and',
    'nowhere else.',
].join(' ');

export const ROUTING_FIND_BUILDINGS_LINE = [
    `- Which buildings touch a resource — \`${ENTRY_POINT_LOOKUP.buildingSearch}\`, filtered by build input,`,
    'recipe input, recipe output or minable resource; those are four different questions, and a single match',
    'comes back as the full card.',
].join(' ');

export const ROUTING_RESOURCE_LENS_LINE = [
    `- Everything about one resource at once — \`${ENTRY_POINT_LOOKUP.resource}\`: what mines it, what is built`,
    'out of it, what eats it every cycle, what makes it, plus its shelves and its transit-fee floor.',
].join(' ');

export const ROUTING_RECIPES_LINE = [
    `- Recipes — \`${ENTRY_POINT_LOOKUP.recipes}\` owns them: ids, cycle duration, inputs, outputs and the $CPU`,
    'a cycle costs are read there, and are deliberately not copied here so that the two can never disagree.',
].join(' ');

export const ROUTING_UNKNOWN_ID_LINE = [
    `- An id the catalog does not carry: \`${ENTRY_POINT_LOOKUP.resource}\` answers with empty groups and`,
    `\`inCatalog: false\`, while \`${ENTRY_POINT_LOOKUP.building}\` throws on an unknown building type — expect`,
    'an answer from the one and an error from the other.',
].join(' ');

export const STATIC_SECTION_TITLE = 'Static reference (read once):';

export const BUILDING_INDEX_SECTION_TITLE = 'Building index';

export const EMPTY_CATALOG_NOTE = 'No buildings in the catalog of this network.';

export const REVEAL_PAYMENT_UNKNOWN_SUMMARY = [
    'every reveal is charged, the first reveal of a cell included, but this network serves no price for it, so',
    'the amounts are unknown here — `cpu_reveal` reads the current budget and burn from the Cell before paying.',
].join(' ');

export const SELF_SERVICE_RANDOMNESS_SUMMARY = [
    'self-service — `cpu_reveal` runs both steps itself and hands back the drawn deposits; if it returns',
    '`fulfilled: false` the request is paid for and still open, so call `cpu_reveal` on that cell again to',
    'finish it.',
].join(' ');

export const PUSH_RANDOMNESS_SUMMARY = [
    'push — the randomness source delivers the draw itself, so deposits land asynchronously after `cpu_reveal`',
    '(poll `cpu_get_cell`); a reveal-fulfilment tool has nothing to do on this network.',
].join(' ');

export const STORAGE_SHELVES_SUMMARY = [
    'storage caps are explicit per-resource cell/hub shelf pairs (`0` means unlimited for WCPU alone and no',
    'room for every other resource); map reads label the',
    'shelf currently in force as each resource storage `cap`, and the machine block below carries every pair',
].join(' ');

export const TRANSIT_FEE_FLOOR_SUMMARY =
    "every resource carries a transit-fee floor ($CPU/u; a hub's non-zero override wins over it)";

export const NONE_LABEL = 'none';
