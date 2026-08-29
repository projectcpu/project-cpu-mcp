# Funding and entry

Use this reference to inspect how the current wallet can support the Operator's objective. It offers available funding and entry branches; it does not prefer one asset path or spending plan. Read the balance, owned Cells, and pending work that matter to the decision, then compare current costs and consequences before a paid action.

## Recover spendable $CPU

`$CPU` pays game costs such as reveals, construction, production, transport, and trade. ETH covers gas and can buy `$CPU`. wCPU is the Forge output held in a Cell and can become on-chain `$CPU`. A Cell is the land needed to reveal deposits and begin production.

- ETH can become `$CPU`: `cpu_quote_swap` shows the current ETH-to-`$CPU` trade, and `cpu_swap` executes it when that trade fits the objective. Refresh `cpu_get_balance` before relying on the result.
- wCPU in an owned Cell can become wallet `$CPU` through `cpu_withdraw`. Use the executed amount from the result because emission headroom can reduce it to a Partial tranche.
- Saleable resources can fund the wallet through the resource Lot flow when a suitable Hub, Route, buyer, and price exist. Inspect that live market rather than assuming a sale.
- If the current wallet has no ETH, wCPU, owned Cell, saleable resources, or known incoming value, report that no recovery action is available through the current MCP state. The Operator may need to fund the wallet externally; the closed system applies to raw-resource reservoirs, not to all wallet funding.

## Acquire a Cell

The current MCP supports the collection's primary SeaDrop public drop. When a new Cell serves the objective, use `cpu_quote_mint` to inspect its live price, availability, and wallet limit. If those terms fit, confirm the wallet can cover the quoted ETH plus gas, call `cpu_mint_cell`, and inspect the resulting Cell before planning a Reveal.

Cell NFT secondary-market actions are outside the current MCP tool surface. Do not invent Cell listing, offer, purchase, or cancellation tools. Resource Lots and Fills trade resources, not Cells.

## Reveal and enter the world

Inspect the target Cell and current config before revealing. `cpu_reveal` reads and pays the live Reveal payment and starts the randomness request. It may require both ETH and `$CPU`; if funds are short, compare the available recovery branches before retrying. Re-read the payment when a transaction or delay may have changed it.

The configured Randomness source determines how the draw arrives. A self-service request may be completed by `cpu_reveal` itself, by the background sweep, or with `cpu_fulfill_reveal` when an open request still needs Fulfilment. In push mode, the source delivers the draw and the Cell can be polled. Completing an existing Reveal request pays no second Reveal payment.

Use `cpu_get_cell` for the resulting Reveal state and deposits. `cpu_get_map` or `cpu_get_attention` can add broader context when the next decision needs it. Continue with whichever production or logistics option serves the Operator's objective.
