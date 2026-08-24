export const RETURN_LOT_DESCRIPTION = [
    'Send one of your lots home: the whole unsold remainder ships from its hub to a cell you own, on-chain.',
    'Requires a session. Works on an OPEN lot (the offer is withdrawn) and on an EVICTED one (the hub owner',
    'threw it out and the units are still yours) — pass the lot and the client picks the right branch. Pass',
    'chain = [hub, ...waypoints, your destination cell] for the whole route (required). It is always the whole',
    'remainder, never part of it, and never more than one lot. Quote it first with `cpu_quote_lot_return`: the',
    'fee that quote names is the exact ceiling this call carries, so a fee that moved since then reverts',
    'instead of overspending. The units are credited only after they arrive and you `cpu_finalize_delivery` on',
    'the returned deliveryId.',
].join(' ');

export const DESTINATION_TRANSFER_WARNING =
    'The goods land in the destination cell, not in your wallet: transfer or sell that cell before the ' +
    'delivery is finalized and the returned resources arrive under its new owner.';
