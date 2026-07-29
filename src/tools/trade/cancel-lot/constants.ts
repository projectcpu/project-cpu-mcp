export const CANCEL_LOT_DESCRIPTION = [
    'Withdraw an OPEN lot; the unsold units return to you, on-chain. Requires a session.',
    'Pass chain = [hub, ...waypoints, your destination cell] for the return shipment (required). One atomic tx: a',
    'return through a foreign Hub costs a $CPU transit fee (auto-approved), otherwise it is free; you also pay gas.',
    'The units ship back and are credited only after they arrive and you `cpu_finalize_delivery` on the returned',
    'deliveryId. Track with `cpu_list_my_lots` / `cpu_get_lot`.',
].join(' ');
