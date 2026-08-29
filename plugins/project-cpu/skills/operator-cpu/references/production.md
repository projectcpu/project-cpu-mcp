# Production and crafting

Read `cpu_get_game_config` once for the session. The runtime tool descriptions and current reads define inputs, costs, limits, and errors. Re-read a Cell after a transaction settles or after a meaningful delay.

## Establish a production Cell

1. Inspect the revealed Cell with `cpu_get_cell`. Confirm ownership, completed reveal, deposits, warehouse balances and capacity, the building state, the selected mode, and any active process.
2. Use `cpu_find_buildings` and the current catalog to choose an extractor for a deposit, or a crafter for a recipe. Check Build inputs, $CPU cost, construction time, upgrade path, and output capacity before committing.
3. Preflight construction from the current Cell and catalog, then call `cpu_build`. Verify the resulting building and its construction state with `cpu_get_cell`.
4. Wait for construction to finish. `cpu_get_cell` must report the building as ready before mining, crafting, routing, or Hub work. If the selected building cannot serve the objective, inspect its direct upgrade choices and current materials, preflight the cost, call `cpu_upgrade`, then verify the target building and its new construction state.
5. Select a mining resource or recipe mode from the Cell outputs. A mode change can burn $CPU. Read the current price before `cpu_start_mining` or `cpu_craft`, then verify the selected mode in the result and with `cpu_get_cell`.

## Mine in bounded runs

1. Read the extractor, deposit, cycle length, storage box, and existing process with `cpu_get_cell`.
2. Select a bounded schedule from the available deposit, cycle duration, and time before the next review. `batches` commits the Cell until the run finishes, and the process has no cancel path.
3. Preflight the target resource, selected mode cost, ready building, and room for at least one whole mining cycle. Call `cpu_start_mining` only after those reads.
4. Verify the started process with `cpu_get_mining_status`. At each review, claim matured output with `cpu_claim_mining`, then verify the warehouse and process with `cpu_get_cell` and `cpu_get_mining_status`.
5. A finished or depleted process still holds the Cell slot until `cpu_claim_mining` banks the remaining output. Claim it, verify that the slot is free, then schedule a new bounded run if the deposit and objective still support one.

## Recover warehouse pressure

Warehouse Full means a storage box has reached capacity. Process Stall means the box has less room than one whole output cycle, so an active process stops before the box reports full. Inspect the process with `cpu_get_mining_status` or `cpu_get_craft_status` and inspect storage with `cpu_get_cell`; do not wait for passive progress.

Choose an offload that leaves room for a complete Cycle before restarting production. Craft consumed input on the Cell, sell it through the relevant resource pipeline, withdraw wCPU, or move it to an owned Cell. For transport, inspect both Cells and the route, call `cpu_quote_transport` against the selected amount and path, then call `cpu_transport`. After arrival, call `cpu_finalize_delivery` and verify source and destination storage with `cpu_get_cell`. A fresh read and quote are required if route ownership, Hub readiness, fee, source balance, or destination room changes.

Claim matured batches after space exists. Verify the stalled flag has cleared and the process has resumed with `cpu_get_mining_status` or `cpu_get_craft_status`. Start a new bounded run only after a finished process has been claimed and the Cell slot is free.

## Craft a recipe chain

1. Call `cpu_list_recipes`, then read each required Cell with `cpu_get_cell`. Build the dependency order from the recipe inputs and outputs. Check the chosen crafter's Build inputs, current building mode, and storage room for one whole output batch.
2. Produce or acquire the first inputs. For inputs on another Cell, inspect route and capacity, call `cpu_quote_transport`, then call `cpu_transport`. After the delivery arrives, call `cpu_finalize_delivery` and verify the destination balance with `cpu_get_cell`.
3. Preflight the recipe inputs for every planned batch, its mode-switch cost, $CPU cost, ready crafter, free process slot, and output capacity. Call `cpu_craft` for a bounded schedule, then verify its selected recipe and status with `cpu_get_craft_status`.
4. Claim matured output with `cpu_claim_craft`. Verify the output balance and free process slot with `cpu_get_cell` and `cpu_get_craft_status` before feeding that output into the next recipe stage.
5. Repeat the input transport, preflight, craft, claim, and verification steps for each later recipe. Stop and recover capacity if any stage reports a Process Stall.

## Forge and withdraw

The `forge_wcpu` recipe converts its listed inputs into wCPU on a ready CPU Forge. Read `cpu_list_recipes` and `cpu_get_cell`, move required inputs through a quoted and finalized delivery if needed, then preflight recipe inputs, forge cost, mode-switch cost, process slot, and output room. Call `cpu_craft` with `forge_wcpu`, verify progress with `cpu_get_craft_status`, and bank wCPU with `cpu_claim_craft`.

Read the Cell's wCPU balance, choose an amount that serves the objective, and preflight the withdrawal against that balance. Call `cpu_withdraw`, then verify both the reduced Cell balance with `cpu_get_cell` and the spendable $CPU wallet balance with `cpu_get_balance`. The withdrawal result can report a partial execution, so use the executed amount rather than assuming the requested amount reached the wallet.
