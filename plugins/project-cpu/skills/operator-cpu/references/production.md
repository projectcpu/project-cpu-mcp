# Production and crafting

Use this reference to understand production options on the current Cells. Building, Mode, Process length, Upgrade, and offload choices are strategic decisions, not a fixed progression. Current config, Cell state, and tool descriptions define the executable costs and limits.

## Establish a production Cell

Inspect a relevant revealed Cell with `cpu_get_cell`: ownership, deposits, Warehouse room, building, Mode, and Process state constrain its options. `cpu_find_buildings` and the current catalog can compare extractors, crafters, Build inputs, $CPU cost, construction time, Upgrade links, and output capacity when the right building is not already known.

If building serves the objective, `cpu_build` starts its Construction window. `cpu_upgrade` follows one valid direct Upgrade link and starts a new Construction window while preserving Cell-bound state described by the tool. Production and active Hub routing or trade require Ready; Hub fee intent can still be configured during Construction so it is in place when the Hub becomes Ready.

An extractor or crafter's Mode selects one supported output. The first selection and restarting the same output are free; changing Mode can burn the live Switch cost. Compare the Cell's outputs before `cpu_start_mining` or `cpu_craft`, then use the confirmed result as the authority on what actually burned.

## Mine in bounded runs

The current runtime schedules mining as a bounded Process. `batches` commits its Cell until the schedule ends or the deposit empties; there is no cancel or mid-Process Mode change. Size the commitment from the Operator's horizon, the deposit, Cycle duration, Warehouse room, and expected need for the Cell rather than from one default batch count.

`cpu_get_mining_status` shows progress and claimable output. `cpu_claim_mining` banks whole matured Cycles without stopping a running Process. An ended Process continues to hold the process slot until its remaining output is claimed; claim it when the objective needs the inventory or the free slot, then verify with `cpu_get_cell` or `cpu_get_mining_status`.

## Recover warehouse pressure

Warehouse Full means a resource reached its Effective cap. Process Stall means less than one whole output Cycle fits, so settlement stops before the Warehouse necessarily reports Full. `cpu_get_mining_status`, `cpu_get_craft_status`, and `cpu_get_cell` show which condition applies.

Possible responses include consuming the resource in a recipe, selling it through a resource Lot, withdrawing wCPU, or moving inventory to another owned Cell. Compare these against the Operator's objective and leave room for at least one complete Cycle if production should resume. For a chosen move, inspect the Cells and Route, use `cpu_quote_transport`, then `cpu_transport`; after arrival, `cpu_finalize_delivery` makes the inventory usable. Refresh a Quote when a decision-bearing Route, fee, balance, or capacity fact changes.

After room exists, a claim can settle matured Batches and reset a stalled Process. Verify the Stall cleared before assuming time is producing value again. A new Process remains unavailable until the prior completed one releases the Cell's process slot.

## Craft a recipe chain

`cpu_list_recipes` exposes the current Recipe inputs, outputs, duration, and $CPU cost. Use `cpu_get_cell` to compare Cells that can run the Recipe and whether producing, buying, or moving each input better serves the objective. If an input move is selected, quote it with `cpu_quote_transport`, send it with `cpu_transport`, and make the arrived inventory usable with `cpu_finalize_delivery`.

`cpu_craft` takes inputs up front for the requested Batches and can also burn a Switch cost. Choose a bounded commitment that fits current inputs, output room, and expected use of the Cell. `cpu_get_craft_status` shows progress; `cpu_claim_craft` banks matured output. Feed that output into a later Recipe only when that dependency path is the chosen plan, and handle a Process Stall before assuming the chain will continue.

## Forge and withdraw

The `forge_wcpu` Recipe converts its listed inputs into wCPU on a Ready CPU Forge. If forging serves the objective, inspect the live Recipe and Forge Cell, supply its inputs by production, trade, or Transport, and choose Batches that fit the current Process slot and input plan. `cpu_craft`, `cpu_get_craft_status`, and `cpu_claim_craft` run and bank the chosen work.

When wallet $CPU is useful, `cpu_withdraw` can convert Cell-held wCPU 1:1 while emission budget remains. Compare the requested amount with the Cell balance and the Operator's plan, then use the executed amount from the result because the call may produce a Partial tranche. `cpu_get_cell` and `cpu_get_balance` can verify the two resulting balances.
