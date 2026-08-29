# Funding, Cell market, and entry

Use this reference to inspect how the current wallet can support the Operator's objective. It offers available funding and entry branches; it does not prefer one asset path or spending plan. Read the balance, owned Cells, and pending work that matter to the decision, then compare current costs and consequences before a paid action.

## Balance $CPU and gas

`$CPU` pays game costs such as reveals, construction, production, transport, and trade. ETH covers gas. wCPU is the Forge output held in a Cell and can become on-chain `$CPU`. A Cell is the land needed to reveal deposits and begin production.

- `cpu_quote_swap` and `cpu_swap` work in both directions. ETH can buy `$CPU`; `$CPU` can become ETH when the wallet needs more gas. The swap itself is an on-chain transaction and still needs a spendable native balance, so it cannot bootstrap a wallet from zero gas. Keep enough native balance for the transactions that follow, and use `cpu_get_balance` when the resulting wallet balance matters.
- wCPU in an owned Cell can become wallet `$CPU` through `cpu_withdraw`. Use the executed amount from the result because emission headroom can reduce it to a Partial tranche.
- Saleable resources can fund the wallet through the resource Lot flow when a suitable Hub, Route, buyer, and price exist. Inspect that live market rather than assuming a sale.
- If the visible wallet balances, owned Cells, saleable inventory, and known incoming value expose no usable funding branch, report that current MCP state plainly. External funding remains an Operator choice; the closed loop applies to raw-resource reservoirs, not to every wallet asset.

## Acquire a Cell

The current MCP supports the collection's primary SeaDrop public drop. When a new Cell serves the objective, use `cpu_quote_mint` to inspect its live price, availability, and wallet limit. If those terms fit, confirm the wallet can cover the quoted ETH plus gas, call `cpu_mint_cell`, and inspect the resulting Cell before planning a Reveal.

The secondary Cell market is a separate NFT-order market. It trades whole Cell NFTs for its configured currency; it is not the Hub resource market, and its listings and offers are never resource Lots. `cpu_get_cell_market` shows the best active listing and offer for one Cell. `cpu_get_my_listings`, `cpu_get_my_offers`, and `cpu_get_my_offers_received` expose the authenticated wallet's active orders; continue pagination with the returned `nextCursor` until it is null when a complete inventory matters.

Every Cell-market action is pinned to an exact order or intent:

- `cpu_buy_cell` buys the listing named by `expectedOrderHash` for one `tokenId`, subject to the caller's `maxAmount`. It does not substitute another listing when that order changes.
- `cpu_list_cell` publishes one owned Cell at a gross base-unit price and expiry, optionally reserved to one buyer. Marketplace and creator fees come out of that gross price, and the result reports the estimated proceeds. Its collection approval is a persistent approval over the wallet's Cells, not an approval limited to the listed token.
- `cpu_make_cell_offer` publishes an item offer for one exact Cell. The amount is expressed in the configured currency's base units; use the currency metadata and the tool's input description rather than treating it as a human-readable decimal.
- `cpu_accept_cell_offer` accepts the exact `orderHash` selected from received offers. Item offers already name their Cell; trait or collection offers require the seller to choose the `tokenId` being sold.
- `cpu_cancel_order` cancels one exact order created by the wallet, whether it is a listing or an offer.

Before listing a Cell or accepting an offer, inspect the Cell-bound Warehouse, deposits, building, Mode, Process, reservations, and inbound Deliveries that ownership will carry to the buyer. Before buying, compare that state with the exact price, currency, expiry, and order hash. A stale, filled, cancelled, expired, repriced, or unfulfillable order is a changed option to reconsider, not permission to pick a replacement automatically. Re-read ownership and relevant Cell state after a completed purchase or sale.

## Reveal and enter the world

Inspect the target Cell and current config before revealing. `cpu_reveal` reads and pays the live Reveal payment and starts the randomness request. It may require both ETH and `$CPU`; if funds are short, compare the available recovery branches before retrying. Re-read the payment when a transaction or delay may have changed it.

The configured Randomness source determines how the draw arrives. A self-service request may be completed by `cpu_reveal` itself, by the background sweep, or with `cpu_fulfill_reveal` when an open request still needs Fulfilment. In push mode, the source delivers the draw and the Cell can be polled. Completing an existing Reveal request pays no second Reveal payment.

Use `cpu_get_cell` for the resulting Reveal state and deposits. `cpu_get_map` or `cpu_get_attention` can add broader context when the next decision needs it. Continue with whichever production or logistics option serves the Operator's objective.
