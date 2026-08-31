# Production and crafting

Use live config and Cell state for construction, Mode, Process, Upgrade, and offload decisions.

## Find a production path

Start with the target resource. `cpu_get_resource` maps its Minable resource, Build input, Recipe input, and Recipe output roles. Keep these commitments distinct.

Filter `cpu_find_buildings` by role:

- `minableResource`: extractors that draw it from a deposit;
- `recipeOutput`: crafters that produce it;
- `recipeInput`: crafters that consume it each Cycle;
- `buildInput`: buildings that consume it once during construction.

Open a candidate with `cpu_get_building`. Its operation section lists supported Recipes; the card also shows construction, Upgrade, Switch cost, and demolition. Use `cpu_list_recipes` to compare exact inputs, outputs, duration, and $CPU cost across Recipes. Building a crafter does not start production. When Ready, `cpu_craft` selects a supported Recipe and Batches and debits inputs up front.

## Establish a production Cell

Use `cpu_get_cell` to check ownership, deposits, Warehouse room, building, Mode, and Process. A catalog match does not guarantee that a building can operate on that Cell.

`cpu_build` starts Construction. `cpu_upgrade` follows one direct Upgrade link and starts another Construction window while preserving deposits, liquid Warehouse balances, and Mode. Production, routing, and Hub trade require Ready. `cpu_set_sale_fee` can configure an owned Hub during Construction.

Mode selects one supported output. The first selection and restarting that output are free; a change can burn the live Switch cost. Check Cell outputs before `cpu_start_mining` or `cpu_craft`. The result reports the actual burn.

`cpu_demolish` requires a free Process slot and, for a Hub, no blocking Route or Lot dependency. It burns configured $CPU and materials, clears the building and Mode, and starts the rebuild cooldown. Deposits and other Warehouse balances remain. Read live costs and blockers from the building card and Cell.

## Mine in bounded runs

Mining is a bounded Process. `batches` commits the Cell until completion or deposit exhaustion. It cannot be cancelled or change Mode. Size it by horizon, deposit, Cycle duration, Warehouse room, and later use of the Cell.

`cpu_get_mining_status` shows progress and claimable output. `cpu_claim_mining` banks whole matured Cycles without stopping the Process. An ended Process holds its slot until the remainder is claimed. Verify the Cell or status after claiming.

## Recover warehouse pressure

Full means a resource reached its Effective cap. Stall means less than one output Cycle fits, which can occur before Full. Check with Process status and `cpu_get_cell`.

Responses include Recipe consumption, a resource Lot, wCPU withdrawal, or Transport to another owned Cell. Leave room for one complete Cycle to resume production. For Transport, choose a Route with `cpu_route_network` or `cpu_next_hops`, quote it, submit it once, and finalize the Delivery.

After room exists, claim matured Batches to reset the Stall. Verify it cleared. The next Process requires the prior Process to release its slot.

## Craft a recipe chain

`cpu_list_recipes` shows Recipe inputs, outputs, duration, and $CPU cost. Use `cpu_get_cell` to find a compatible Cell and compare producing, buying, or moving each input. For moved inputs, quote and submit the Transport, then finalize its Delivery.

`cpu_craft` takes inputs up front and may burn a Switch cost. Choose Batches that fit inputs, output room, and later Cell use. `cpu_get_craft_status` shows progress; `cpu_claim_craft` banks matured output. Clear any Stall before continuing the Recipe chain.

## Forge and withdraw

The `forge_wcpu` Recipe converts its inputs into wCPU on a Ready CPU Forge. Inspect the live Recipe and Cell, supply inputs through production, trade, or Transport, then run and claim the Process.

`cpu_withdraw` converts Cell-held wCPU to wallet $CPU 1:1 while emission budget remains. Use the executed amount because it may be a Partial tranche.
