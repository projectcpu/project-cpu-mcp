export const RETURN_LOT_DESCRIPTION = [
    'Send one of your lots home: the whole unsold remainder ships from its hub to a cell you own, on-chain.',
    'Requires a session. Works on an OPEN lot (the offer is withdrawn) and on an EVICTED one (the hub owner',
    'threw it out and the units are still yours) — pass the lot and the client picks the right branch. Pass',
    'chain = [hub, ...waypoints, your destination cell] for the whole route (required). It is always the whole',
    'remainder, never part of it, and never more than one lot. Quote it first with `cpu_quote_lot_return` and',
    'pass the `maxTransitFeeWei` it answers with back here: this call re-prices the route on-chain and, if the',
    'fee has moved above the ceiling you passed, refuses before approving or sending anything rather than',
    'overspend it. The units are credited only after they arrive and you `cpu_finalize_delivery` on the',
    'returned deliveryId.',
].join(' ');

export const MAX_TRANSIT_FEE_WEI_DESCRIPTION = [
    'The most transit you will pay for this return, in WEI (not $CPU) — copy the `maxTransitFeeWei` field',
    'from the `cpu_quote_lot_return` you just ran for this same lot and route, unchanged. The route is',
    're-priced on-chain before anything is approved or sent, and a price above this figure is refused, so a',
    'ceiling that went stale costs you a re-quote instead of the difference. Only the first hop of a return',
    'is capped on-chain, so any later waypoint can raise its rate between the quote and this call.',
].join(' ');

export const WEI_INPUT_PATTERN = /^\d+$/;

export const WEI_INPUT_MESSAGE =
    'maxTransitFeeWei is a whole number of wei — pass the maxTransitFeeWei field from cpu_quote_lot_return ' +
    'unchanged, not the decimal $CPU figure.';

export const DESTINATION_TRANSFER_WARNING =
    'The goods land in the destination cell, not in your wallet: transfer or sell that cell before the ' +
    'delivery is finalized and the returned resources arrive under its new owner.';
