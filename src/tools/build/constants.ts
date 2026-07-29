export const BUILD_DESCRIPTION = [
    'Place a building on a revealed Land cell you own (needs a session — `cpu_authenticate` first). Pick a',
    '`buildingType` from the catalog (`cpu_get_game_config`): an extractor mines a raw deposit, a crafter runs a',
    'recipe, the hub routes transport/trade. Costs $CPU (some buildings also consume refined resources from the',
    "cell's warehouse); the tool auto-approves the $CPU spend once, sends the on-chain place, and waits for",
    'confirmation. Building takes time — it is not usable until it finishes. Once ready, start an extractor with',
    '`cpu_start_mining` or a crafter with `cpu_craft`. A cell holds one building: re-running build on the same',
    'building is a safe no-op; to switch buildings `cpu_demolish` first (a just-demolished cell is locked from',
    'rebuilding until its cooldown ends). Inspect the result with `cpu_get_cell`.',
].join(' ');

export const DEMOLISH_DESCRIPTION = [
    'Remove the building from a Land cell you own, clearing it for a different building. Requires a session —',
    'call `cpu_authenticate` first. Not free: it burns a fraction of the building’s build cost in $CPU',
    '(auto-approved) and consumes some of its build materials from the cell’s warehouse (no refund) — see each',
    "building's `demolishCost` in `cpu_get_game_config` for the exact amounts. The cell must have no active mining",
    'or craft process — a craft frees its slot once fully claimed, but a mining run only ends when its deposit is',
    'exhausted, so a mining extractor cannot be demolished mid-run; a `hub` can only be demolished when it is not mid-route or',
    'anchoring open trade lots. Deposits and other warehouse balances are preserved. Afterward the plot is locked',
    'from rebuilding until its demolish cooldown ends (its `demolishFinishAt`); `cpu_get_cell`/`cpu_get_attention`',
    'surface the cooldown.',
].join(' ');
