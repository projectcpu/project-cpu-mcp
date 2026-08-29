# External Cell market

The OpenSea market trades whole Cell NFTs through orders in its configured settlement currency. Treat each action as a change of Cell ownership, including the Warehouse, deposits, building, Mode, Process, reservations, and inbound Deliveries attached to that Cell.

`cpu_get_cell_market` shows one Cell's best active listing and offer. `cpu_get_my_listings`, `cpu_get_my_offers`, and `cpu_get_my_offers_received` show wallet orders. Follow `nextCursor` until null for a complete list.

Pin every action to its exact order or intent:

- `cpu_buy_cell` buys `expectedOrderHash` for one `tokenId`, capped by `maxAmount`. It never substitutes another listing.
- `cpu_list_cell` publishes one owned Cell at a gross base-unit price and expiry, optionally for one buyer. Marketplace and creator fees reduce seller proceeds. Collection approval persists across the wallet's Cells.
- `cpu_make_cell_offer` offers on one Cell. Express the amount in the configured currency's base units.
- `cpu_accept_cell_offer` accepts one `orderHash`. Item offers name the Cell; trait or collection offers also need `tokenId`.
- `cpu_cancel_order` cancels one wallet-created listing or offer.

Before a sale, inspect the state that follows the Cell. Before a buy, compare that state with the exact price, currency, expiry, and `orderHash`. If the order changes or fails, return to the Operator instead of substituting another. Verify ownership and Cell state after settlement.
