export const GET_MAP_DESCRIPTION = [
    'Read the live game world (public, background-synced). The world is a finite sphere of 48,990 cells keyed by',
    'tokenId — no coordinates: navigate via each cell’s `neighbors` (6 adjacent, 5 next to a pentagon vertex;',
    'owned/other/empty, empty = unminted) and `cpu_next_hops`; `pos {face,i,j}` is only a rough hint (wraps at',
    'face seams). Returns a `summary`, a `resourceIndex` of your cells, and per-resource `storage`',
    '(used/cap/full; a box with room for less than one whole cycle halts that resource’s production, cap null',
    '= uncapped). Scopes: mine | around',
    '(grid radius from aroundTokenId) | cells | all | summary. version/updated are epoch ms, serverTime/startAt',
    'unix seconds. `server.reachable` false means actions will fail; your to-do list is `cpu_get_attention`.',
].join(' ');
