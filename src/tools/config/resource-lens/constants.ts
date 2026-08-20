export const GET_RESOURCE_DESCRIPTION = [
    'Return everything the rulebook holds about ONE resource, read from the resource side instead of the',
    'building side, so "what do I do with steel" costs one call rather than a walk of the whole catalog.',
    'Input is the resource id as `cpu_get_game_config` lists it. The answer keeps the four roles a resource',
    'plays apart and never mixes them: MINED BY — extractors that draw it from the deposit of their own cell;',
    'BUILD INPUT TO — buildings that burn it ONCE at construction and never again; RECIPE INPUT TO — recipes',
    'that consume it on EVERY production cycle, each with the buildings that run them; RECIPE OUTPUT OF —',
    'recipes that produce it. A building erected out of the resource that also processes it appears in both',
    'groups, separately, because those are two different commitments of the same resource. Alongside the four:',
    'the cell shelf and hub shelf bounding how much of it one cell may hold, and its transit fee floor — the',
    'per-unit minimum a foreign hub charges to route it. What the resource trades for is deliberately NOT',
    'here: `cpu_get_market_index` owns that number and caches it, and a live figure copied into a static',
    'reference reads as fresh long after it stopped being. A resource nothing touches answers with empty',
    'groups, which is an answer and not an error.',
    'A read-only reference call. No session needed.',
].join(' ');

export const LENS_HEADLINE_TAIL = 'what mines it, what is built out of it, what eats it and what makes it.';

export const MINED_BY_SECTION = 'Mined by (extractors that draw it from the deposit of their own cell):';

export const BUILD_INPUT_TO_SECTION = 'Build input to (burned once to erect the building, never again):';

export const RECIPE_INPUT_TO_SECTION = 'Recipe input to (consumed by every production cycle):';

export const RECIPE_OUTPUT_OF_SECTION = 'Recipe output of (produced by every production cycle):';

export const STORAGE_SECTION_TITLE = 'Storage';

export const TRANSIT_SECTION_TITLE = 'Transit';

export const CELL_SHELF_LABEL = 'Cell shelf';

export const HUB_SHELF_LABEL = 'Hub shelf';

export const TRANSIT_FEE_FLOOR_LABEL = 'Transit fee floor';

export const EMPTY_GROUP_VALUE = 'none';

export const UNLIMITED_SHELF_VALUE = 'unlimited';

export const SHELVES_MISSING_NOTE = 'not listed in the loaded config';

export const TRANSIT_FEE_FLOOR_MISSING_NOTE = 'not listed in the loaded config — unknown, never free';

export const TRANSIT_FEE_FLOOR_NOTE = "a hub's non-zero override for this resource wins over it";

export const IDLE_RESOURCE_NOTE =
    'Nothing in the catalog mines, burns, eats or makes this resource — an answer, not an error.';

export const UNKNOWN_RESOURCE_NOTE = [
    'No resource carries this id in the loaded config, so the groups below are empty for want of a resource',
    'rather than for want of participants; cpu_get_game_config lists every resource id.',
].join(' ');

export const PER_CYCLE_LABEL = 'per cycle';

export const PER_BUILD_LABEL = 'per build';

export const RUN_BY_LABEL = 'run by';

export const LENS_INDENT = '  ';
