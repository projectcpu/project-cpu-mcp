# Funding and entry

Read relevant balances, owned Cells, and pending work before a paid action.

## Balance $CPU and gas

`$CPU` pays game costs. A CPU Forge produces Cell-held wCPU, which can become wallet `$CPU`. A Cell provides land for Reveal and production.

- `cpu_quote_swap` and `cpu_swap` support ETH ↔ `$CPU`.
- `cpu_withdraw` converts Cell-held wCPU into wallet `$CPU`. Use the executed amount because emission headroom can produce a Partial tranche.
- Resource Lots can fund the wallet when a suitable Hub, Route, buyer, and price exist. Check the live market.
- If no visible funding branch works, report it. External funding remains the Operator's choice.

## Mint a Cell

For the primary SeaDrop public drop, `cpu_quote_mint` returns price, availability, and wallet limit. If accepted, call `cpu_mint_cell`, then inspect the Cell before Reveal.

## Reveal and enter the world

Inspect the Cell and config before Reveal. `cpu_reveal` pays the live ETH and `$CPU` payment and starts the randomness request.

The Randomness source controls delivery. In self-service mode, `cpu_reveal`, the background sweep, or `cpu_fulfill_reveal` can complete an open request. In push mode, poll the Cell. Completing an open request pays no second Reveal payment.

Read the result with `cpu_get_cell`. Use `cpu_get_map` or `cpu_get_attention` only when the next decision needs wider context.
