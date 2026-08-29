# Funding and entry

Start with the session route in the Project CPU skill. `cpu_persona` establishes the operating brief. Then call `cpu_authenticate`; Paybox handles browser authorization and wallet secrets stay out of chat. Read `cpu_get_game_config` once, then refresh `cpu_get_balance`, `cpu_get_map`, and `cpu_get_attention` before selecting work.

Use the same loop for each branch: observe current state, plan the shortest viable path, quote or preflight a paid action, act within the Operator's request and the host harness's authority rules, then verify the result. Re-read mutable state after a transaction settles or time elapses. MCP tool descriptions remain authoritative for inputs, outputs, limits, and errors.

## Recover spendable $CPU

`$CPU` pays game costs such as reveals, construction, production, transport, and trade. ETH covers gas and can buy `$CPU`. wCPU is the Forge output held in a Cell and can become on-chain `$CPU`. A Cell is the land needed to reveal deposits and begin production.

Read the balance and owned Cells before choosing a funding branch.

- With ETH and too little `$CPU`, use `cpu_quote_swap` to size an ETH-to-`$CPU` trade. If the quote supports the objective, call `cpu_swap` selling ETH, then refresh `cpu_get_balance` before the next paid action.
- With wCPU in an owned Cell, use `cpu_withdraw`, then refresh `cpu_get_balance`. Check the result because the executed withdrawal can be smaller than the requested amount.
- With a Cell or saleable resources, inspect the current world and the relevant market or trade route before selling. Keep resource Lots distinct from Cell Market orders.
- With no ETH, wCPU, Cell, or saleable resources, report the blocker to the Operator. The closed economy has no spendable recovery path from that state.

## Acquire a Cell

If no owned Cell can serve the objective, begin with the primary SeaDrop path. Use `cpu_quote_mint` to inspect live price, availability, and limits. Confirm `cpu_get_balance` covers the quoted ETH and gas. Call `cpu_mint_cell`, then refresh the map and inspect the minted Cell before planning a reveal.

For a secondary-market Cell, use the Cell Market route. Select the exact Market order identity and follow that route's quote, action, and verification steps. Resource Lots and Fills cannot buy a Cell.

## Reveal and enter the world

Inspect the owned Cell and the current config before revealing. `cpu_reveal` pays the current reveal charge and starts the randomness request. It may require both ETH and `$CPU`; refresh the balance and resolve a shortfall before retrying. Do not reuse an old quote after a transaction or delay.

The configured randomness mode determines the next step. When the reveal result is pending and the network requires player fulfillment, call `cpu_fulfill_reveal` for the open request. When the network settles the draw itself, wait for the request to resolve and re-read the Cell. Do not pay for a second reveal while completing an existing request.

Verify entry with `cpu_get_cell`, `cpu_get_map`, and `cpu_get_attention`: the Cell should show the expected reveal state, deposits or pending work, and any follow-up attention item. Continue with the production, logistics, or market route that matches the Operator's objective.
