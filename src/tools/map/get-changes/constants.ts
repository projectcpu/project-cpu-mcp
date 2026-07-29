export const GET_CHANGES_DESCRIPTION = [
    'Get only the cells that changed since a given version — react to other players without re-reading the whole',
    'map. Pass the `version` from a previous map response; the reply carries a new `version` for next time. Omit',
    'sinceVersion (or 0) to get everything. Also carries `server: { reachable }`: false means the API is',
    'unreachable, so any action (build/reveal/transport/trade) will fail — keep polling `cpu_get_changes` rather',
    'than retrying actions; the client reconnects in the background, and once reachable flips true you can act',
    'again (after an outage, call once with sinceVersion 0 for the full picture).',
].join(' ');
