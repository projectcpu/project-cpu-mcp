export const GET_BUILDING_DESCRIPTION = [
    'Return one building of the catalog as a card, so a question about a single building never costs the whole',
    'catalog. Input is the catalog `type` (as `cpu_get_game_config` lists it). The card prints three separate',
    'plans and never mixes them: CONSTRUCTION — $CPU cost, build time and the build inputs burned once to erect',
    'it; OPERATION — for a crafter every recipe it runs as recipe inputs to recipe outputs with the cycle',
    'duration and the $CPU it costs per cycle, for an extractor the minable resources it draws from the cell',
    'deposit (an extractor consumes no input resources at all), for a hub what it routes; LIFECYCLE — demolish',
    'cost, mode switching, and the upgrade links in both directions. Build inputs are not a recipe: they are',
    'spent once at construction, while recipe inputs are consumed by every production cycle afterwards.',
    'A read-only reference call. No session needed.',
].join(' ');

export const CONSTRUCTION_SECTION_TITLE = 'Construction';

export const OPERATION_SECTION_TITLE = 'Operation';

export const LIFECYCLE_SECTION_TITLE = 'Lifecycle';

export const BUILD_INPUTS_LABEL = 'Build inputs';

export const RECIPE_INPUTS_LABEL = 'Recipe inputs';

export const RECIPE_OUTPUTS_LABEL = 'Recipe outputs';

export const MINABLE_RESOURCES_LABEL = 'Minable resources';

export const NO_BUILD_INPUTS_VALUE = 'none, $CPU only';

export const EXTRACTOR_NO_INPUT_RESOURCES_NOTE =
    'No input resources: an extractor draws from the deposit of the cell it stands on and consumes nothing to run.';

export const HUB_OPERATION_NOTE =
    'Produces nothing: a hub routes transport and settles trade on its cell, and charges transit and sale fees.';

export const NO_MINABLE_RESOURCES_NOTE = 'Nothing to mine: this building draws from no deposit.';

export const RECIPE_DETAILS_MISSING_NOTE = 'details absent from the loaded config; read cpu_list_recipes';

export const UNPRICED_OPEX_NOTE = 'plus a per-recipe opex the chain adds on top (not priced here)';

export const FREE_CYCLE_VALUE = 'free';

export const MODE_SWITCH_IMPOSSIBLE_NOTE = 'cannot switch — one output or none, so it can never be re-pointed';

export const MODE_SWITCH_UNKNOWN_NOTE = 'unknown — this config predates the price; cpu_get_cell prices it per cell';

export const NO_UPGRADE_PREDECESSOR_VALUE = 'none (base building)';

export const NO_UPGRADE_SUCCESSOR_VALUE = 'none (terminal)';

export const UNKNOWN_BUILDING_TYPE_HINT = 'cpu_get_game_config lists every catalog type';

export const CARD_INDENT = '  ';

export const RECIPE_PLAN_INDENT = '    ';
