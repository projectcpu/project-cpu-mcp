# Logistics and resource trade

Use this reference to compare Route and resource-trade options. It does not prescribe the shortest or cheapest path: distance, ETA, Transit fee, Same-clan discount, reach, Warehouse room, and trust in foreign Hubs may matter differently to the Operator. A graph and Quote describe one state snapshot and reserve nothing, so refresh the decision when a relevant owner, readiness state, fee, balance, capacity, Lot, or waypoint changes.

## Transport cargo

Inspect candidate Route endpoints and Warehouse room with `cpu_get_map`. `cpu_route_network` can export the current graph for code-assisted planning; `cpu_next_hops` can scout it locally. Compare valid chains according to the Operator's priorities. A disconnected graph is a current world constraint, not a permanent failure: report the wall and visible options such as another destination, a detour, land ownership, or an eligible Hub bridge.

Validate the selected chain and amount with `cpu_quote_transport`. A failed Quote is information for replanning, not a spendable result. If the quoted decision still fits, `cpu_transport` creates a Delivery and returns its id and arrival time. `cpu_list_my_transports` shows when it can be finalized, and `cpu_finalize_delivery` makes the cargo usable. Re-read the destination with `cpu_get_map` when the resulting Warehouse balance matters to the next decision.

## Buy resources

`cpu_list_lots` and `cpu_get_lot` expose current resource Lots. Compare available resource, amount, Hub, seller, price, OPEN state, Route, and destination room rather than assuming the first Lot is suitable. `cpu_next_hops` or `cpu_route_network` can help find a chain from the listing Hub to an owned revealed destination.

`cpu_quote_buy` binds one Lot, amount, Route, live Sale fee, Same-clan discount, Transit cost, arrival time, and total debit. If that exact decision still fits, `cpu_buy_lot` creates a Fill and Delivery. A Frozen or temporarily unroutable Lot can be reconsidered later; another current Lot or Route may also satisfy the objective. Finalize an arrived Delivery with `cpu_finalize_delivery`, using `cpu_list_my_transports` and `cpu_get_map` when readiness or resulting inventory matters.

## Sell resources and recover escrow

`cpu_get_lot_terms` shows the live size window, seller capacity, Hub conditions, and Evicted remainders for one resource. Compare candidate Hubs, Routes, fees, visibility, and risk before choosing where to list. `cpu_next_hops` or `cpu_route_network` can support the selected source-to-Hub chain.

`cpu_create_lot` escrows the chosen inventory and records the seller tolerance: the highest live Sale fee the seller accepts. The Lot remains DELIVERING until its arrival is finalized, then becomes OPEN. `cpu_list_my_transports`, `cpu_finalize_delivery`, and `cpu_get_lot` expose that transition. `cpu_list_my_lots` and `cpu_list_fills` show the remaining ask and completed Fills when monitoring serves the objective.

The Hub's live Sale fee settles on each Fill. Above the seller tolerance, the Lot is Frozen and buys revert until the rate falls or the seller starts a Lot return. Membership and Syndicate rates can change Sale and Transit economics, so current terms and Quotes are more useful than cached assumptions.

A Hub owner can Evict one foreign OPEN Lot. Eviction releases the Hub space but leaves that Lot's whole remainder in seller-owned escrow and unbuyable. When the seller chooses to recover an OPEN or Evicted remainder, select an owned revealed destination and Route, inspect candidates with `cpu_next_hops` or `cpu_route_network`, and use `cpu_quote_lot_return` for the whole remainder. `cpu_return_lot` acts on that one Lot; copy the Quote's `maxTransitFeeWei` unchanged. After its Delivery arrives, `cpu_finalize_delivery` returns the inventory to the destination Warehouse. `cpu_get_map`, `cpu_list_my_lots`, and `cpu_get_lot` can verify the resulting state.
