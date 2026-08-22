export const DEFAULT_MATCH_LIMIT = 50;

export const MAX_MATCH_LIMIT = 200;

export const FIND_BUILDINGS_DESCRIPTION = [
    'Search the building catalog by what a building consumes, produces or mines ("which buildings process',
    'steel"). Filters are optional and combine with AND. The four resource filters are four distinct roles:',
    '`buildInput` — a build input, burned ONCE to erect the building; `recipeInput` — a recipe input, consumed',
    'on EVERY production cycle;',
    '`recipeOutput` — what a cycle produces; `minableResource` — what an extractor draws from its own cell',
    'deposit. `kind` and `tier` narrow further. Answers are index rows (type, name, kind, tier, build cost, one',
    `line of what it does), up to ${DEFAULT_MATCH_LIMIT} by default — narrow the filters rather than paging. A`,
    'single match returns the full card, as `cpu_get_building` does. No match is a plain answer, not an error.',
    'Read-only. No session needed.',
].join(' ');

export const INDEX_COLUMNS_LEGEND = 'One row each — type | name | kind | tier | build cost | what it does:';

export const NO_FILTERS_LABEL = 'no filters, so the whole catalog';

export const NO_MATCH_HINT =
    'Not an error: the catalog holds no such building. Loosen a filter, or check the resource ids with cpu_get_game_config.';

export const SINGLE_MATCH_NOTE = 'Exactly one building matches, so here is its full card instead of a row.';

export const TRUNCATED_HINT = 'Narrow the filters to see the rest — the catalog is finite and there is no second page.';
