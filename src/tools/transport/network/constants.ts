export { ROUTE_NETWORK_DESCRIPTION } from '../constants.js';

export const ROUTE_NETWORK_TITLE = 'ROUTE NETWORK';

export const ROUTE_NETWORK_LABELS = {
    waypoints: 'Waypoints',
    own: 'Yours',
    hubs: 'Hubs',
    hops: 'Legal hops',
    components: 'Components',
    reach: 'Reach',
    paid: 'Paid waypoints',
    from: 'From',
    towards: 'Towards',
    steps: 'Grid steps',
    link: 'Link',
    note: 'Note',
};

export const ROUTE_NETWORK_LINKED = 'one component holds both ends — a chain exists, build it from the hops';
export const ROUTE_NETWORK_SPLIT = 'the ends are NOT connected through this network — a gap to bridge first';
