export const SALE_FEE_STRUCTURAL_BOUND_PERCENT = 100;

export const GET_GAME_CONFIG_DESCRIPTION = [
    'Return the game rulebook for the active network: the resource catalog (id → name), the building catalog',
    '(name, kind — extractor/crafter/hub — and $CPU cost; the full JSON also carries each building’s mine/craft',
    'bindings and build time), reveal-cost params (first reveal free; re-reveal price), how this network delivers',
    'randomness (self-service or push — it decides what `cpu_reveal` does), the on-chain contract addresses, and',
    'the recipe count (use `cpu_list_recipes` for the full recipe graph). A free reference read —',
    'call it once to ground planning. No session needed.',
].join(' ');

export const SELF_SERVICE_RANDOMNESS_SUMMARY = [
    'self-service — `cpu_reveal` runs both steps itself and hands back the drawn deposits; if it returns',
    '`fulfilled: false` the request is paid for and still open, so call `cpu_reveal` on that cell again to',
    'finish it.',
].join(' ');

export const PUSH_RANDOMNESS_SUMMARY = [
    'push — the randomness source delivers the draw itself, so deposits land asynchronously after `cpu_reveal`',
    '(poll `cpu_get_cell`); a reveal-fulfilment tool has nothing to do on this network.',
].join(' ');
