export const LOT_RETURN_REVERT_NAMES = [
    'FeeExceedsMax',
    'LotNotOpen',
    'LotNotEvicted',
    'NotSeller',
    'WrongHub',
    'NotDestOwner',
    'PathTooShort',
    'DegenerateWaypoint',
    'NotEligibleWaypoint',
    'HopOutOfRange',
    'NotWaypointOwner',
    'NotRevealed',
    'BelowMinAmount',
    'ZeroAmount',
] as const;

export const LOT_RETURN_REVERT_REASONS: Readonly<Record<(typeof LOT_RETURN_REVERT_NAMES)[number], string>> = {
    FeeExceedsMax:
        'the transit fee moved above the figure the return quote had just priced, so the route was refused ' +
        'and nothing was spent — quote the return again and send it straight away',
    LotNotOpen: 'the lot is no longer open — re-read it, then return it through the branch its state calls for',
    LotNotEvicted: 'the lot is not evicted — re-read it, then return it through the branch its state calls for',
    NotSeller: 'the lot is not yours to return',
    WrongHub: "the route must start at the lot's hub",
    NotDestOwner: 'the last cell on the route must be one you own',
    PathTooShort: 'the route needs at least the hub and your destination cell',
    DegenerateWaypoint: 'the route visits the same cell twice',
    NotEligibleWaypoint: 'a waypoint on the route is not eligible — a foreign frozen hub blocks the path',
    HopOutOfRange: "a hop on the route is longer than transport's reach",
    NotWaypointOwner: 'a non-hub waypoint on the route is not owned by you',
    NotRevealed: 'a cell on the route (or the hub) is not revealed yet',
    BelowMinAmount: "the remainder is below transport's minimum shipment",
    ZeroAmount: 'the lot has no units left to send home',
};
