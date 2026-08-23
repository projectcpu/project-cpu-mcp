export const QUOTE_TRANSPORT_DESCRIPTION = [
    'Preview a transport route (a waypoint chain of tokenIds) without committing: returns `fee` — the actual $CPU',
    '(decimal) you will pay across foreign hubs — and `discount`, the same-clan member saving already applied',
    '(the nominal fee equals fee + discount), plus the summed grid distance and the arrival timestamp. Read-only',
    'on-chain view with no side effects. It also validates the chain and names the rejection reason: a hop longer',
    'than radius(from)+radius(to)−1 grid steps, an ineligible waypoint (foreign land past its first completed',
    'reveal carrying no finished Hub — Virgin ground and foreign finished Hubs are passage, not obstacles), or',
    'endpoints that are not your own cells past their first completed reveal. A successful quote validates route',
    'mechanics and economics at quote time; it does not promise the later `cpu_transport` will succeed —',
    'ownership, balances, capacity, pauses, allowances and live state all still apply then. Plan the chain with',
    '`cpu_route_network` when you have a code runner and with `cpu_next_hops` when you do not; use this before',
    '`cpu_transport`.',
].join(' ');
