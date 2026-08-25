/**
 * The buy-quote revert map ships as agent-facing prose, so it is pinned here rather than inlined in the
 * helper: `src/__tests__/tool-registry.test.ts` scans it for the vocabulary the surface must never use.
 */
export const QUOTE_REVERT_REASONS: ReadonlyArray<{ name: string; reason: string }> = [
    { name: 'LotNotOpen', reason: 'the lot is closed — sold out, still delivering, or cancelled' },
    { name: 'ExceedsRemaining', reason: "the amount exceeds the lot's remaining units" },
    { name: 'InvalidValue', reason: 'the buy amount must be greater than zero' },
    {
        name: 'SaleFeeExceedsMax',
        reason:
            "the lot is frozen: the hub's live sale fee now exceeds the seller's tolerance, so the buy reverts " +
            'until the hub lowers the rate (or the seller sends the remainder home)',
    },
    { name: 'WrongHub', reason: "the route must start at the lot's hub" },
    { name: 'NotDestOwner', reason: 'the destination cell (route end) must be one you own' },
    { name: 'PathTooShort', reason: 'the route needs at least the hub and your destination cell' },
    {
        name: 'NotEligibleWaypoint',
        reason:
            'a waypoint on the route is not eligible — a hub on the path cannot serve as a live node right now ' +
            '(temporarily unroutable, not frozen)',
    },
    { name: 'HopOutOfRange', reason: "a hop on the route is longer than transport's reach" },
    { name: 'NotWaypointOwner', reason: 'a non-hub waypoint on the route is not owned by you' },
    { name: 'DegenerateWaypoint', reason: 'the route repeats a waypoint' },
    { name: 'NotRevealed', reason: 'a cell on the route (or the hub) is not revealed yet' },
    { name: 'BelowMinAmount', reason: "the amount is below transport's minimum" },
];
