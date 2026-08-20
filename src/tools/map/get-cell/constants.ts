export const GET_CELL_DESCRIPTION = [
    'Inspect one cell in depth (any owner — the map is public). Returns the cell, its neighbours expanded as full',
    'cell states (the immediate surroundings of a target), and `distanceFromMine` — the grid distance (BFS steps)',
    'to your nearest cell (null if your wallet is unknown or it is farther than 50 steps). Each resource carries a',
    '`storage` box (used/cap/reserved/full) and the active process a `stalled` flag — true once the room holds',
    'less than one whole cycle of its output, which halts production before the box reads `full`, until you',
    'offload. For broader situational awareness use `cpu_get_map`.',
].join(' ');

export const CELL_OVERVIEW_TITLE = 'CELL OVERVIEW';

export const CELL_OVERVIEW_LABELS = {
    cell: 'Cell',
    owner: 'Owner',
    reveals: 'Reveals',
    deposits: 'Deposits',
    building: 'Building',
    job: 'Job',
    nearestOwn: 'Nearest own',
    neighbours: 'Neighbours',
    note: 'Note',
};

export const CELL_OVERVIEW_MINE = 'yours';
export const CELL_OVERVIEW_FOREIGN = 'not yours';
export const CELL_OVERVIEW_NO_WALLET = 'wallet unknown';
export const CELL_OVERVIEW_NO_BUILDING = 'none';
export const CELL_OVERVIEW_READY = 'ready';
export const CELL_OVERVIEW_IDLE = 'idle';
export const CELL_OVERVIEW_STALLED = 'stalled';
export const CELL_OVERVIEW_REVEAL_PENDING = 'request open';
