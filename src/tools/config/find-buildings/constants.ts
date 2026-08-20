export const DEFAULT_MATCH_LIMIT = 50;

export const MAX_MATCH_LIMIT = 200;

export const FIND_BUILDINGS_DESCRIPTION = [
    'Search the building catalog by what a building consumes, produces or mines, so a question like "which',
    'buildings process steel" is answered without reading the whole catalog. Every filter is optional and',
    'they combine with AND. The four resource filters are the four separate roles a resource plays, and they',
    'never mean the same thing: `buildInput` — resources burned ONCE to erect the building, `recipeInput` —',
    'resources a crafter consumes on EVERY production cycle, `recipeOutput` — what such a cycle produces,',
    '`minableResource` — what an extractor draws from the deposit of its own cell. Asking for steel as a',
    'build input finds what is built out of steel; asking for it as a recipe input finds what eats steel to',
    'run — different buildings, different questions. `kind` and `tier` narrow further. Answers are index rows',
    `— type, name, kind, tier, build cost and one line of what it does — up to ${DEFAULT_MATCH_LIMIT} of them`,
    'by default; narrow the filters rather than paging. A single match comes back as the full building card,',
    'the same one `cpu_get_building` returns. No match is a plain answer, not an error.',
    'A read-only reference call. No session needed.',
].join(' ');

export const INDEX_COLUMNS_LEGEND = 'One row each — type | name | kind | tier | build cost | what it does:';

export const NO_FILTERS_LABEL = 'no filters, so the whole catalog';

export const NO_MATCH_HINT =
    'Not an error: the catalog holds no such building. Loosen a filter, or check the resource ids with cpu_get_game_config.';

export const SINGLE_MATCH_NOTE = 'Exactly one building matches, so here is its full card instead of a row.';

export const TRUNCATED_HINT = 'Narrow the filters to see the rest — the catalog is finite and there is no second page.';
