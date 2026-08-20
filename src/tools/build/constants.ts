export const BUILD_PANEL_TITLE = 'BUILDING PLACEMENT';

export const BUILD_PANEL_LABELS = {
    cell: 'Cell',
    building: 'Building',
    status: 'Status',
    finishesIn: 'Finishes in',
    paid: 'Paid',
    approveTx: 'Approve tx',
    buildTx: 'Build tx',
    purpose: 'Purpose',
    next: 'Next',
};

export const BUILD_PANEL_STATUS_STARTED = 'construction started; the building does not work yet';
export const BUILD_PANEL_STATUS_NOOP = 'no transaction sent; this building already stands on the cell';
export const BUILD_PANEL_PURPOSE_HUB = 'routes transport and trade';
export const BUILD_PANEL_NEXT_AFTER = 'after construction ends,';
export const BUILD_PANEL_NEXT_MINE = 'start extraction with cpu_start_mining';
export const BUILD_PANEL_NEXT_CRAFT = 'run a recipe with cpu_craft';
export const BUILD_PANEL_NEXT_INSPECT = 'inspect it with cpu_get_cell';

export const UPGRADE_PANEL_TITLE = 'BUILDING UPGRADE';

export const UPGRADE_PANEL_LABELS = {
    cell: 'Cell',
    from: 'From',
    to: 'To',
    status: 'Status',
    finishes: 'Finishes',
    paid: 'Paid',
    materials: 'Materials',
    approveTx: 'Approve tx',
    upgradeTx: 'Upgrade tx',
    next: 'Next',
};

export const UPGRADE_PANEL_STATUS_STARTED =
    'construction started; production and hub functions are unavailable until it ends';
export const UPGRADE_PANEL_STATUS_NOOP_UPGRADING =
    'no transaction sent; the target already stands on the cell and is still going up';
export const UPGRADE_PANEL_STATUS_NOOP_SETTLED =
    'no transaction sent; the target already stands on the cell with no construction running';
export const UPGRADE_PANEL_NEXT_INSPECT = 'inspect progress with cpu_get_cell';

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

export const UPGRADE_DESCRIPTION = [
    'Upgrade the building on a Land cell you own to a dynamically configured target type — needs a session',
    '(`cpu_authenticate` first). Pick `targetBuildingType` from the current catalog (`cpu_get_game_config`): only',
    'upgraded entries (those with a predecessor) are valid targets — a base building belongs to `cpu_build`.',
    "Costs the target's full configured $CPU build cost (auto-approved once); reuses the same on-chain placement",
    'as `cpu_build`, so it installs the target immediately and starts a new construction timer. The contract is',
    'the final authority on whether the target is a valid direct successor, on active processes, demolition',
    'cooldown, materials, and storage capacity — this tool does not pre-check any of them locally, so a stale',
    'local view never blocks a transaction the chain would accept. Deposits, liquid warehouse balances, and the',
    'selected mode survive the upgrade. Production and Hub functionality are unavailable until construction',
    'finishes; inspect progress with `cpu_get_cell`.',
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
