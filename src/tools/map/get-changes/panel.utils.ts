import {
    CHANGE_FEED_DEGRADED_EFFECT,
    CHANGE_FEED_LABELS,
    CHANGE_FEED_LIVE_EFFECT,
    CHANGE_FEED_LOADING_EFFECT,
    CHANGE_FEED_MAP_DEGRADED,
    CHANGE_FEED_MAP_LIVE,
    CHANGE_FEED_MAP_LOADING,
    CHANGE_FEED_MAP_NO_STREAM,
    CHANGE_FEED_MAP_STOPPED,
    CHANGE_FEED_REQUESTS_ANSWERING,
    CHANGE_FEED_REQUESTS_UNREACHABLE,
    CHANGE_FEED_SOURCE,
    CHANGE_FEED_STOPPED_EFFECT,
    CHANGE_FEED_STREAM_CONNECTED,
    CHANGE_FEED_STREAM_DOWN_EFFECT,
    CHANGE_FEED_STREAM_DROPPED,
    CHANGE_FEED_TITLE,
} from './constants.js';
import type { ChangeFeedInput } from './types.js';
import { MapReadiness } from '../../../map/types.js';
import { formatUnixSeconds } from '../../../utils/format.utils.js';
import { renderPanel } from '../../../utils/panel.utils.js';

// A loaded map still advances only while the stream is up, so `Ready` without a socket is held back too.
const HELD_BACK_STATE: Record<MapReadiness, string> = {
    [MapReadiness.Ready]: CHANGE_FEED_MAP_NO_STREAM,
    [MapReadiness.Loading]: CHANGE_FEED_MAP_LOADING,
    [MapReadiness.Degraded]: CHANGE_FEED_MAP_DEGRADED,
    [MapReadiness.Stopped]: CHANGE_FEED_MAP_STOPPED,
};

const HELD_BACK_EFFECT: Record<MapReadiness, string> = {
    [MapReadiness.Ready]: CHANGE_FEED_STREAM_DOWN_EFFECT,
    [MapReadiness.Loading]: CHANGE_FEED_LOADING_EFFECT,
    [MapReadiness.Degraded]: CHANGE_FEED_DEGRADED_EFFECT,
    [MapReadiness.Stopped]: CHANGE_FEED_STOPPED_EFFECT,
};

function isLive(readiness: MapReadiness, socketConnected: boolean): boolean {
    return readiness === MapReadiness.Ready && socketConnected;
}

function mapState(readiness: MapReadiness, socketConnected: boolean): string {
    return isLive(readiness, socketConnected) ? CHANGE_FEED_MAP_LIVE : HELD_BACK_STATE[readiness];
}

function effect(readiness: MapReadiness, socketConnected: boolean): string {
    return isLive(readiness, socketConnected) ? CHANGE_FEED_LIVE_EFFECT : HELD_BACK_EFFECT[readiness];
}

// The version is the newest `updated` the map holds (epoch ms), so it dates the map by what was actually
// recorded — unlike the store's server clock, which keeps advancing on the local clock after the feed stops.
function lastAdvanced(version: number): string | null {
    return version <= 0 ? null : formatUnixSeconds(Math.floor(version / 1000));
}

export function changeFeedPanel(input: ChangeFeedInput): string {
    const labels = CHANGE_FEED_LABELS;
    const { reachable, reason } = input.health;

    return renderPanel({
        title: CHANGE_FEED_TITLE,
        rows: [
            [
                { label: labels.source, value: CHANGE_FEED_SOURCE },
                {
                    label: labels.requests,
                    value: reachable ? CHANGE_FEED_REQUESTS_ANSWERING : CHANGE_FEED_REQUESTS_UNREACHABLE,
                },
                { label: labels.map, value: mapState(input.readiness, input.socketConnected) },
                {
                    label: labels.stream,
                    value: input.socketConnected ? CHANGE_FEED_STREAM_CONNECTED : CHANGE_FEED_STREAM_DROPPED,
                },
            ],
            [
                { label: labels.since, value: `v${input.since}` },
                { label: labels.changed, value: `${input.changes.changedCount}` },
                { label: labels.recorded, value: `v${input.changes.version}` },
                { label: labels.advanced, value: lastAdvanced(input.changes.version) },
            ],
            [{ label: labels.reason, value: reachable ? null : reason }],
            [{ label: labels.effect, value: effect(input.readiness, input.socketConnected) }],
        ],
    });
}
