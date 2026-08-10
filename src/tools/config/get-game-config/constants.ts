export const SALE_FEE_STRUCTURAL_BOUND_PERCENT = 100;

export const GET_GAME_CONFIG_DESCRIPTION = [
    'Return the game rulebook for the active network: the resource catalog (id → name), the building catalog',
    '(name, kind — extractor/crafter/hub — and $CPU cost; the full JSON also carries each building’s mine/craft',
    'bindings and build time), a compact upgrade graph for every building that has a predecessor or a successor',
    '(catalog type, level, branch, immediate predecessor/successors, cost, inputs, build time, and effects — feed',
    'this into `cpu_upgrade`), one compact line per recipe (id, cycle duration, inputs, outputs, $CPU/cycle),',
    'reveal-cost params (first reveal free; re-reveal price), how this network delivers randomness (self-service',
    'or push — it decides what `cpu_reveal` does), and the on-chain contract addresses. A free reference read —',
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

export const NO_RECIPES_CONFIGURED_NOTE = 'No recipes configured.';

export const NO_UPGRADE_PARTICIPANTS_NOTE = 'No buildings currently participate in an upgrade line.';

export const BASE_BUILDING_PREDECESSOR_LABEL = 'none (base building)';

export const TERMINAL_UPGRADE_SUCCESSOR_LABEL = 'none (terminal)';

export const CYCLE_TIME_MODIFIER_NOTE =
    'a cycle-time modifier applied on top of the base production cycle, not an absolute duration';

export const EXTRACTOR_COMPATIBILITY_NOTE =
    'compatible resources only — actual mining yield is set at runtime, not a guaranteed amount';
