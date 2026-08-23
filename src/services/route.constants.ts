export const NEXT_HOPS_NOTE =
    'These are the legal next waypoints only — choosing the route is up to you. A hop is legal up to ' +
    'radius(from)+radius(to)\u22121 grid steps, and every cell brings its own radius: a plain cell the move ' +
    'radius, a finished Hub the radius its own tier serves (`reach` per candidate — hub tiers differ). ' +
    'Waypoints are open Virgin ground (`isVirgin` — no completed reveal, minted or not, so nobody controls the ' +
    'ground and the ground itself charges nothing, but a foreign finished Hub standing on Virgin ground still ' +
    'charges its transit fee, while a Hub of your own on it charges you nothing — `transitFeePerUnit` per ' +
    'candidate is what you pay), your own cells, and any cell with a ' +
    'finished Hub; only foreign land past its first reveal without a finished Hub is closed. A Hub ' +
    'counts only once its construction finishes: until then it grants no hub reach and charges no fee, and a ' +
    'foreign one is no waypoint at all (`ready` says which). A shipment still starts and ends on your own ' +
    'revealed cells — Virgin ground and foreign Hubs are passage, not endpoints. ' +
    'Chain hops yourself and verify the full chain ' +
    'with cpu_quote_transport; legality and fees are enforced on-chain.';

export const ROUTE_NETWORK_NOTE =
    'This is the road map, not a route — nodes are every legal waypoint and edges are hops the contract ' +
    'will accept. A Hub counts only once its construction finishes — an unfinished one grants no hub reach and ' +
    'charges no fee, and only your own cells stay nodes while they build (`ready` says which). Pick your own ' +
    'chain over it and verify with cpu_quote_transport.';

export const DISTANCE_SCAN_CAP = 300;

export const INCOMPLETE_SNAPSHOT_MESSAGE =
    'The map bootstrap has not finished, so routing is refused: on a partial map a cell that is merely missing ' +
    'would read as unminted Virgin ground and invent routes that do not exist. Retry once the map is loaded — ' +
    'cpu_get_map reports its readiness.';

export const UNREADABLE_ROWS_MESSAGE =
    'The map loaded, but this client could not read every row of it, so routing is refused: a row it cannot ' +
    'hold would read as unminted Virgin ground and invent routes that do not exist. Waiting will not help — ' +
    'update to a client that understands the rows this world serves.';
