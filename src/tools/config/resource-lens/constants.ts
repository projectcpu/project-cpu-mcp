export const GET_RESOURCE_DESCRIPTION = [
    'Everything the rulebook holds about ONE resource ("what do I do with steel"), in one call. Input is the',
    'resource id as `cpu_get_game_config` lists it. Four roles kept apart: MINED BY — extractors that draw it',
    'from their own cell deposit; BUILD INPUT TO — buildings that burn it ONCE at construction; RECIPE INPUT',
    'TO — recipes consuming it on EVERY cycle, with the buildings that run them; RECIPE OUTPUT OF — recipes',
    'producing it. A building both built from and processing the resource appears in both groups. Also: the',
    'cell and hub shelves bounding how much one cell may hold, and its transit fee floor (per-unit minimum a',
    'foreign hub charges). Market price is NOT here — `cpu_get_market_index` owns it. A resource nothing',
    'touches answers with empty groups, not an error. Read-only. No session needed.',
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

export const UNLIMITED_SHELF_CAP = 0;

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
