export const NEXT_HOPS_NOTE =
    'These are the legal next waypoints only — choosing the route is up to you. A Hub counts only once its ' +
    'construction finishes: until then it grants no hub reach and charges no fee, and a foreign one is no ' +
    'waypoint at all (`ready` says which). Chain hops yourself and verify the full chain with ' +
    'cpu_quote_transport; legality and fees are enforced on-chain.';

export const ROUTE_NETWORK_NOTE =
    'This is the road map, not a route: nodes are every legal waypoint, edges are hops the contract will ' +
    'accept. A Hub counts only once its construction finishes — an unfinished one grants no hub reach and ' +
    'charges no fee, and only your own cells stay nodes while they build (`ready` says which). Pick your own ' +
    'chain over it and verify with cpu_quote_transport.';

export const DISTANCE_SCAN_CAP = 300;
