export { ROUTE_NETWORK_DESCRIPTION } from '../constants.js';

export const ROUTE_NETWORK_TITLE = 'ROUTE GRAPH';

export const ROUTE_NETWORK_LABELS = {
    graph: 'Graph file',
    schema: 'Schema',
    snapshot: 'Snapshot',
    waypoints: 'Waypoints',
    hops: 'Legal hops',
    from: 'From',
    towards: 'Towards',
    cargo: 'Cargo',
    link: 'Link',
    next: 'Next',
    note: 'Note',
};

export const ROUTE_NETWORK_LINKED = 'one graph holds both ends — compute the chain from the file';
export const ROUTE_NETWORK_SPLIT = 'the ends are NOT connected in this graph — a gap to bridge first';
