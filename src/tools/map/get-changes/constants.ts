export const GET_CHANGES_DESCRIPTION = [
    'Get only the cells that changed since a given version — react to other players without re-reading the whole',
    'map. Pass the `version` from a previous map response; the reply carries a new `version` for next time. Omit',
    'sinceVersion (or 0) to get everything. Also carries `server: { reachable }`: false means the API is',
    'unreachable, so any action (build/reveal/transport/trade) will fail — keep polling `cpu_get_changes` rather',
    'than retrying actions; the client reconnects in the background, and once reachable flips true you can act',
    'again (after an outage, call once with sinceVersion 0 for the full picture).',
].join(' ');

export const CHANGE_FEED_TITLE = 'CHANGE FEED';

export const CHANGE_FEED_LABELS = {
    source: 'Source',
    state: 'State',
    since: 'Since',
    changed: 'Changed',
    recorded: 'Last recorded',
    clock: 'Snapshot clock',
    reason: 'Reason',
    effect: 'Effect',
};

export const CHANGE_FEED_SOURCE = 'game API';
export const CHANGE_FEED_STATE_LIVE = 'live';
export const CHANGE_FEED_STATE_DOWN = 'UNREACHABLE';

export const CHANGE_FEED_LIVE_EFFECT =
    'The feed is live, so every cell that changed since your version is listed here.';

export const CHANGE_FEED_DOWN_EFFECT =
    'Stale — the game API is unreachable, so the map stopped at the version above and nothing newer can ' +
    'reach it. An empty or short list here means unknown, not quiet; do not read it as the world right ' +
    'now, and do not act on it. Re-run once the source answers again.';
