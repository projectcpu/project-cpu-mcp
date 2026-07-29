export const CREATE_LOT_DESCRIPTION = [
    'List units of a resource for sale at a Hub, on-chain (needs a session — `cpu_authenticate` first). One atomic',
    'tx: ships the goods from your source cell to the listing Hub (`chain` = [source, ...waypoints, hub]) and opens',
    'a lot at `pricePerUnit` $CPU, plus gas. A route through a foreign Hub costs a $CPU transit fee (auto-approved',
    'once); over only your own cells it is free. The hub owner charges a sale fee on every sale, carved out of the',
    'seller proceeds (the buyer still pays exactly price × value). `maxSaleFeePercent` is your tolerance: the highest',
    'rate you accept — omit it to lock in the live rate at listing (read on-chain). The hub settles its live rate',
    'each sale (never above your tolerance); if it later rises above the tolerance the lot freezes and buys revert',
    'until the hub lowers it — `cpu_cancel_lot` is always fee-free and returns the escrow. The lot is DELIVERING and',
    'becomes buyable (OPEN) only after its escrow arrives — call `cpu_finalize_delivery` on the returned deliveryId',
    '(or wait). Returns the lotId and the locked-in `maxSaleFeePercent`; track with `cpu_list_my_lots` / `cpu_get_lot`.',
].join(' ');
