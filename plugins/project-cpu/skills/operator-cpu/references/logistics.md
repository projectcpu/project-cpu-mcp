# Logistics and internal resource trade

Compare Routes by the Operator's priorities: distance, ETA, Transit fee, Same-clan discount, reach, room, and foreign Hubs. Graphs and Quotes reserve nothing. Resource Lots trade Warehouse units for $CPU. `funding.md` covers the separate Cell NFT market.

## Transport cargo

Use `cpu_get_map` or `cpu_get_cell` to choose owned revealed endpoints and check source balance and destination room. `cpu_route_network` writes the legal graph from the complete routing snapshot to temporary JSON. It contains the shared endpoint component or, when disconnected, both endpoint components. It omits unrelated components. `cpu_next_hops` gives a one-hop view of the same snapshot.

`connected: false` means no current Route joins those endpoints. Options include another owned destination in the source component or a connectivity change through land, ownership, Hub readiness, or a Hub bridge.

Validate the chain and amount with `cpu_quote_transport`. `cpu_transport` submits the full Route, creates one Delivery, and returns its id and arrival time. The Route cannot change in transit. Use `cpu_list_my_transports` and `cpu_finalize_delivery` to receive the cargo.

## Buy resources

Choose the market read by question:

- `cpu_get_market_index`: historical 24-hour price and volume. It may lag; null price means no trades in the window.
- `cpu_get_markets`: current lowest ask, Lot counts, distance, and advisory live Sale fee by Hub and resource.
- `cpu_list_lots` and `cpu_get_lot`: specific current or incoming Lots and their lifecycle state.
- `cpu_list_fills`: public execution history, not current asks or a wallet ledger.

Compare resource, amount, Hub, seller, price, OPEN state, Route, and destination room.

For a buy Route from its listing Hub, use `cpu_next_hops` to build a chain to an owned revealed destination. Ordinary `cpu_route_network` accepts owned endpoints, so it cannot plan this foreign-Hub Route. With a chain, `cpu_quote_buy` binds the Lot, amount, Sale fee, Same-clan discount, Transit cost, arrival, room, and total debit. Without a chain, it quotes only the sale.

`cpu_buy_lot` creates a Fill and Delivery. A Frozen or temporarily unroutable Lot may recover later. Finalize the Delivery with `cpu_finalize_delivery`.

## Sell resources and recover escrow

`cpu_get_markets` shows candidate Hubs and asks. `cpu_get_lot_terms` checks one Hub and resource for size limits, seller slots, and Evicted remainders that block a new Lot. Compare Hubs, Routes, fees, visibility, and risk. Build a source-to-Hub chain with `cpu_next_hops`; ordinary `cpu_route_network` cannot use a foreign Hub endpoint.

`cpu_create_lot` escrows inventory and records the highest accepted Sale fee. The Lot stays DELIVERING until arrival is finalized, then becomes OPEN. Track the transition with `cpu_list_my_transports`, `cpu_finalize_delivery`, and `cpu_get_lot`. `cpu_list_my_lots` shows owned Lots and remainders. `cpu_list_fills` cannot filter by buyer or seller.

Each Fill uses the Hub's live Sale fee. Above seller tolerance, the Lot is Frozen until the rate falls or the seller starts a Lot return. A Hub owner can change the per-resource fee with `cpu_set_sale_fee`; it applies to existing Lots. Use current terms and Quotes after Membership or Syndicate rate changes.

`cpu_evict_lot` removes one foreign OPEN Lot. Eviction releases Hub space but leaves the remainder in seller-owned escrow and unbuyable. Only the seller can return it.

For an OPEN or Evicted Lot return, choose an owned revealed destination. Pass `lotId` to `cpu_next_hops` or `cpu_route_network` to preserve the Evicted Lot's source reach and fee rule. `cpu_quote_lot_return` validates the whole remainder and Route. `cpu_return_lot` uses `maxTransitFeeWei` as its fee ceiling. Finalize the Delivery, then verify the Warehouse and Lot if needed.
