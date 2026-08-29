# Logistics and resource trade

Use current reads for each route, Quote, Delivery, Lot, and Warehouse decision. A route graph and Quote describe the state at their read time; neither reserves capacity or survives a changed owner, readiness state, fee, or waypoint. Re-plan and re-quote after a meaningful delay or any changed waypoint. Resource Lots and Fills belong to the resource trade flow. They are not Cell Market NFT orders.

## Transport cargo

1. Read the source and destination Warehouse balances and capacity in `cpu_get_map`. Choose a destination that can accept the whole cargo after liquid, reserved, and pending production amounts are counted.
2. Build the current route with `cpu_route_network`. If the graph is disconnected, stop and report the border or ownership/readiness condition that blocks the move.
3. Send the chosen chain to `cpu_quote_transport`. Use its current fee, syndicate discount, arrival time, and capacity result. Do not spend from a failed Quote.
4. If a waypoint changes owner or readiness, if a Hub is built or removed, or if time passes before sending, discard the route and Quote. Start again with a fresh `cpu_route_network`, then a fresh `cpu_quote_transport`.
5. Send `cpu_transport` only with the chain and amount that the fresh Quote covered. Record its delivery id and arrival time.
6. Wait until `cpu_list_my_transports` marks the delivery ready. Finalize it with `cpu_finalize_delivery`.
7. Re-read the destination in `cpu_get_map`. Confirm that the whole cargo credited to its Warehouse. A sent Delivery is not usable inventory before finalization.

## Buy resources

1. Use `cpu_list_lots` to find resource Lots, then inspect the chosen lot with `cpu_get_lot`. Select the exact resource, remaining amount, hub, seller, price, and OPEN state. A Fill is an executed resource-lot purchase, not a Cell Market order.
2. Check the destination Warehouse has room for the full purchase before committing to it.
3. Find a current hub-to-destination chain with `cpu_route_network`. Treat a changed route graph or a changed lot state as a new decision.
4. Request `cpu_quote_buy` for that exact lot, amount, and chain. Use its live sale rate, buyer and seller syndicate discount, transit cost, arrival time, and total debit. A frozen Lot or an unroutable waypoint requires another lot or route, not a reused Quote.
5. Call `cpu_buy_lot` only while the lot, chain, destination capacity, and Quote are still current. Record the returned delivery id.
6. Wait for `cpu_list_my_transports` to report readiness, then use `cpu_finalize_delivery`.
7. Verify with `cpu_get_map` that the purchased resources reached the destination Warehouse. The Fill proves the buy; finalization makes the resources usable.

## Sell resources and recover escrow

1. Ask `cpu_get_lot_terms` for the live Hub and resource terms. Check lot-size limits, current lot capacity, and any Evicted remainders that already need recovery.
2. Build the source-to-Hub path with `cpu_route_network`. Choose it using current foreign-Hub transit costs and relevant syndicate discounts.
3. Create the listing with `cpu_create_lot`, setting a seller tolerance for the maximum sale fee the seller accepts. Record the lot id and delivery id. The lot is not OPEN until its delivery settles.
4. Track the listing through `cpu_list_my_lots`. Read `cpu_list_fills` to distinguish completed Fills from the remaining ask. Re-read the exact lot with `cpu_get_lot` before each market decision.
5. The Hub settles its live rate on each sale. A live sale fee above seller tolerance leaves the Lot Frozen, so purchases revert until the rate falls or the seller returns the remainder. A syndicate can change sale and transit economics; use the current Quote and live terms rather than a cached fee. These resource Lots and Fills remain separate from Cell Market orders.
6. A Hub owner can Evict one foreign OPEN Lot. Eviction leaves the seller's remaining goods escrowed and unbuyable. It neither transfers the goods nor returns every Lot.
7. For an OPEN or Evicted lot that must leave the Hub, quote its whole remaining inventory with `cpu_quote_lot_return` using a current Hub-to-owned-cell chain. Copy its `maxTransitFeeWei` unchanged. If a waypoint or fee changes, quote again.
8. Return exactly that one Lot with `cpu_return_lot`. Wait for `cpu_list_my_transports`, then call `cpu_finalize_delivery`.
9. Verify the destination Warehouse in `cpu_get_map`, and re-check `cpu_list_my_lots` and `cpu_get_lot`. The returned remainder must be absent from escrow before treating the inventory as recovered.
