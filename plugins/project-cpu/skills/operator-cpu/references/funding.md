# Funding, Cell market, and entry

Read relevant balances, owned Cells, and pending work before a paid action.

## Balance $CPU and gas

`$CPU` pays game costs. A CPU Forge produces Cell-held wCPU, which can become wallet `$CPU`. A Cell provides land for Reveal and production.

- `cpu_quote_swap` and `cpu_swap` support ETH ↔ `$CPU`.
- `cpu_withdraw` converts Cell-held wCPU into wallet `$CPU`. Use the executed amount because emission headroom can produce a Partial tranche.
- Resource Lots can fund the wallet when a suitable Hub, Route, buyer, and price exist. Check the live market.
- If no visible funding branch works, report it. External funding remains the Operator's choice.

## Acquire a Cell

For the primary SeaDrop public drop, `cpu_quote_mint` returns price, availability, and wallet limit. If accepted, call `cpu_mint_cell`, then inspect the Cell before Reveal.

The secondary Cell market trades whole Cell NFTs in its configured currency. It is separate from Hub resource Lots. `cpu_get_cell_market` shows one Cell's best active listing and offer. `cpu_get_my_listings`, `cpu_get_my_offers`, and `cpu_get_my_offers_received` show wallet orders. For a complete list, follow `nextCursor` until null.

Pin every Cell-market action to its exact order or intent:

- `cpu_buy_cell` buys `expectedOrderHash` for one `tokenId`, capped by `maxAmount`. It never substitutes another listing.
- `cpu_list_cell` publishes one owned Cell at a gross base-unit price and expiry, optionally for one buyer. Marketplace and creator fees reduce seller proceeds. Collection approval persists across the wallet's Cells.
- `cpu_make_cell_offer` offers on one Cell. Express the amount in the configured currency's base units.
- `cpu_accept_cell_offer` accepts one `orderHash`. Item offers name the Cell; trait or collection offers also need `tokenId`.
- `cpu_cancel_order` cancels one wallet-created listing or offer.

Before a sale, inspect the Warehouse, deposits, building, Mode, Process, reservations, and inbound Deliveries that follow the Cell. Before a buy, compare that state with the exact price, currency, expiry, and `orderHash`. If the order changes or fails, return to the Operator instead of substituting another. Verify ownership and Cell state after settlement.

## Reveal and enter the world

Inspect the Cell and config before Reveal. `cpu_reveal` pays the live ETH and `$CPU` payment and starts the randomness request.

The Randomness source controls delivery. In self-service mode, `cpu_reveal`, the background sweep, or `cpu_fulfill_reveal` can complete an open request. In push mode, poll the Cell. Completing an open request pays no second Reveal payment.

Read the result with `cpu_get_cell`. Use `cpu_get_map` or `cpu_get_attention` only when the next decision needs wider context.
