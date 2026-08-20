import { MapReadiness } from '../../../map/types.js';

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
    requests: 'Requests',
    map: 'Map',
    stream: 'Stream',
    since: 'Since',
    changed: 'Changed',
    recorded: 'Last recorded',
    advanced: 'Last advanced',
    reason: 'Reason',
    effect: 'Effect',
};

export const CHANGE_FEED_SOURCE = 'game API';
export const CHANGE_FEED_REQUESTS_ANSWERING = 'answering';
export const CHANGE_FEED_REQUESTS_UNREACHABLE = 'UNREACHABLE';
export const CHANGE_FEED_STREAM_CONNECTED = 'connected';
export const CHANGE_FEED_STREAM_DROPPED = 'dropped';

export const CHANGE_FEED_MAP_LIVE = 'live';
export const CHANGE_FEED_MAP_LOADING = 'LOADING';
export const CHANGE_FEED_MAP_DEGRADED = 'DEGRADED';
export const CHANGE_FEED_MAP_STOPPED = 'STOPPED';
export const CHANGE_FEED_MAP_NO_STREAM = 'NO STREAM';

export const CHANGE_FEED_LIVE_EFFECT =
    'Live — the map holds the realtime stream and stands at the version above; this list is every ' +
    'change it has recorded since your version.';

export const CHANGE_FEED_STREAM_DOWN_EFFECT =
    'The realtime stream is down, so nothing new can reach the map until it reconnects. Whatever ' +
    'changed since the version above is not here — do not act on this list.';

export const CHANGE_FEED_LOADING_EFFECT =
    'The map is still loading and holds only part of the world, so this is not the full set of changes ' +
    'since your version. Do not act on it; re-run once the map has finished loading.';

export const CHANGE_FEED_DEGRADED_EFFECT =
    'Stale — the map stopped advancing at the version above and the client is retrying the game API. An ' +
    'empty or short list here means unknown, not quiet; do not read it as the world right now, and do ' +
    'not act on it.';

export const CHANGE_FEED_STOPPED_EFFECT =
    'The map sync is not running, so nothing here is being updated at all. This is only what was last ' +
    'recorded — do not read it as the world right now.';

export const HELD_BACK_STATE: Record<MapReadiness, string> = {
    [MapReadiness.Ready]: CHANGE_FEED_MAP_NO_STREAM,
    [MapReadiness.Loading]: CHANGE_FEED_MAP_LOADING,
    [MapReadiness.Degraded]: CHANGE_FEED_MAP_DEGRADED,
    [MapReadiness.Stopped]: CHANGE_FEED_MAP_STOPPED,
};

export const HELD_BACK_EFFECT: Record<MapReadiness, string> = {
    [MapReadiness.Ready]: CHANGE_FEED_STREAM_DOWN_EFFECT,
    [MapReadiness.Loading]: CHANGE_FEED_LOADING_EFFECT,
    [MapReadiness.Degraded]: CHANGE_FEED_DEGRADED_EFFECT,
    [MapReadiness.Stopped]: CHANGE_FEED_STOPPED_EFFECT,
};
