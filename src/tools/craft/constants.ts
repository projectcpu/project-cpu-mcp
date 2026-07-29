export const CRAFT_DESCRIPTION = [
    'Run a craft recipe on a cell you own (refine raw resources, or forge $WCPU). Requires a session —',
    'call `cpu_authenticate` first; discover recipes with `cpu_list_recipes`. Inputs are debited upfront for all',
    'batches. Most recipes are free and start their timer immediately; `forge_wcpu` costs $CPU, which this',
    'tool auto-approves once (a one-time unbounded allowance) before submitting the on-chain payment and',
    'waiting for its confirmation — its timer then starts once the indexer settles the payment a few seconds',
    'later. Pointing a crafter at a recipe other than the one it is already set to also burns its Switch cost,',
    'in the same transaction and the same approval as the recipe cost — the first pick after building, and',
    'restarting the current recipe, are free. Check the price per recipe in `cpu_get_cell` (`outputs`) before',
    'you commit; the result reports the recipe cost and the Switch cost that actually burned separately.',
    'Track progress with `cpu_get_craft_status` and bank matured batches with `cpu_claim_craft`.',
].join(' ');
