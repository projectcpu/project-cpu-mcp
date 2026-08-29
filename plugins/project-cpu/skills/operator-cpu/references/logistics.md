# Logistics and internal resource trade

Use this reference to compare Route and internal resource-market options. It does not prescribe the shortest or cheapest path: distance, ETA, Transit fee, Same-clan discount, reach, Warehouse room, and trust in foreign Hubs may matter differently to the Operator. A graph and Quote describe one state snapshot and reserve nothing, so refresh the decision when a relevant owner, readiness state, fee, balance, capacity, Lot, or waypoint changes. Resource Lots trade Warehouse units for $CPU; Cell NFT listings and offers belong to the separate secondary market described in `funding.md`.

## Transport cargo

Use `cpu_get_map` or `cpu_get_cell` to choose owned revealed endpoints and inspect the source balance and destination room. `cpu_route_network` builds from the complete routing snapshot and writes the legal graph to a temporary JSON file for code-assisted planning. The artifact contains the complete connected component shared by the endpoints, or the union of their two components when they are disconnected; unrelated world components are omitted. `cpu_next_hops` is an alternative one-hop view over the same complete snapshot, useful when local inspection is enough or no code runner is available.

Compare valid chains according to the Operator's priorities. `connected: false` means no legal chain or current detour joins those endpoints in that snapshot. Useful options can include a different owned destination in the source component or a world change that alters connectivity, such as eligible land, ownership, Hub readiness, or a Hub bridge.

Validate the selected chain and amount with `cpu_quote_transport`. A failed Quote is information for replanning, not a spendable result. If the quoted decision still fits, `cpu_transport` submits the entire chain atomically, creates one Delivery, and returns its id and arrival time. The Route cannot be changed while that Delivery is in transit. `cpu_list_my_transports` shows when it can be finalized, and `cpu_finalize_delivery` makes the cargo usable. Re-read the destination when the resulting Warehouse balance matters to the next decision.

## Buy resources

Use each internal-market read for the question it actually answers:

- `cpu_get_market_index` summarizes settled 24-hour prices and volume. It is historical, may be delayed, and a null price means no trades in the window.
- `cpu_get_markets` summarizes current offers by Hub and resource: lowest ask, Lot counts, distance, and an advisory live Sale fee.
- `cpu_list_lots` returns the specific current or incoming Lots behind those markets with filters and sorting; `cpu_get_lot` inspects one Lot in any lifecycle state.
- `cpu_list_fills` is the public execution history: what buyers actually paid, not the current ask and not a wallet-specific trade ledger.

Compare available resource, amount, Hub, seller, price, OPEN state, Route, and destination room rather than treating the first Lot, cheapest ask, or historical average as the answer by itself.

For a buy route beginning at its listing Hub, use `cpu_next_hops` to inspect legal one-hop candidates and assemble a chain to an owned revealed destination. An ordinary `cpu_route_network` export is for owned endpoints and does not plan this foreign-Hub trade route. `cpu_quote_buy` with the chain binds one Lot, amount, live Sale fee, Same-clan discount, Transit cost, arrival time, destination room, and total debit. Without a chain it quotes only the sale leg.

If the full quoted decision still fits, `cpu_buy_lot` creates a Fill and Delivery. A Frozen or temporarily unroutable Lot can be reconsidered later; another current Lot or Route may also satisfy the objective. Finalize an arrived Delivery with `cpu_finalize_delivery`, using `cpu_list_my_transports` and a map read when readiness or resulting inventory matters.

## Sell resources and recover escrow

`cpu_get_markets` can expose candidate Hubs and current asks; `cpu_get_lot_terms` checks one selected Hub and resource for the live size window, seller slot usage, and Evicted remainders that block a new listing there. Compare Hubs, Routes, fees, visibility, and risk before choosing where to list. Use `cpu_next_hops` to inspect a source-to-Hub chain. As with buying, an ordinary `cpu_route_network` export does not accept a foreign Hub as the endpoint.

`cpu_create_lot` escrows the chosen inventory and records the seller tolerance: the highest live Sale fee the seller accepts. The Lot remains DELIVERING until its arrival is finalized, then becomes OPEN. `cpu_list_my_transports`, `cpu_finalize_delivery`, and `cpu_get_lot` expose that transition. `cpu_list_my_lots` tracks the Operator's own Lot lifecycle and remainder. `cpu_list_fills` can add public execution evidence for a Hub or resource, but it cannot filter by buyer or seller and is not an account ledger.

The Hub's live Sale fee settles on each Fill. Above the seller tolerance, the Lot is Frozen and buys revert until the rate falls or the seller starts a Lot return. An Operator who owns the Hub can change its per-resource Sale fee with `cpu_set_sale_fee`; the new live rate applies to existing Lots and can freeze or unfreeze them against their individual tolerances. Membership and Syndicate rates can change Sale and Transit economics, so current terms and Quotes are more useful than cached assumptions.

`cpu_evict_lot` lets a Hub owner remove one foreign OPEN Lot per call. Eviction releases the Hub reservation but leaves that Lot's whole remainder in seller-owned escrow and unbuyable; it does not move or seize the goods. Only the seller can route that remainder home.

For an OPEN or Evicted Lot return, choose an owned revealed destination and pass the `lotId` when using `cpu_next_hops` or `cpu_route_network`; that context is what preserves an Evicted Lot's historical source reach and fee rule. `cpu_quote_lot_return` validates the whole remainder and Route. `cpu_return_lot` acts on that one Lot and uses the Quote's `maxTransitFeeWei` as the fee ceiling. After its Delivery arrives, `cpu_finalize_delivery` returns the inventory to the destination Warehouse. Map and Lot reads can verify the resulting state when it matters.
