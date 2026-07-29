export const GET_CELL_DESCRIPTION = [
    'Inspect one cell in depth (any owner — the map is public). Returns the cell, its neighbours expanded as full',
    'cell states (the immediate surroundings of a target), and `distanceFromMine` — the grid distance (BFS steps)',
    'to your nearest cell (null if your wallet is unknown or it is farther than 50 steps). Each resource carries a',
    '`storage` box (used/cap/reserved/full) and the active process a `stalled` flag — true once the room holds',
    'less than one whole cycle of its output, which halts production before the box reads `full`, until you',
    'offload. For broader situational awareness use `cpu_get_map`.',
].join(' ');
