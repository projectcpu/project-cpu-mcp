export const QUOTE_LOT_RETURN_DESCRIPTION = [
    'Preview sending one of your lots home — the whole unsold remainder, from its hub to a cell you own —',
    'without spending anything. Requires a session. Works on an OPEN lot and on an EVICTED one. Pass',
    'chain = [hub, ...waypoints, your destination cell] for the whole route (required). Answers with the exact',
    'remainder, the destination, the transit fee and syndicate discount, the total distance, the arrival time,',
    'and whether the destination can still take the whole remainder right now. The fee it names is the ceiling',
    'to hand `cpu_return_lot` as its `maxTransitFeeWei`: that call re-prices the route and refuses rather than',
    'pay above the figure you pass it, so run this immediately before the return and pass the wei field back',
    'unchanged.',
].join(' ');
