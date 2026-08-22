import {
    CHANGE_FEED_LABELS,
    CHANGE_FEED_LIVE_EFFECT,
    CHANGE_FEED_MAP_LIVE,
    CHANGE_FEED_REQUESTS_ANSWERING,
    CHANGE_FEED_REQUESTS_UNREACHABLE,
    CHANGE_FEED_SOURCE,
    CHANGE_FEED_STREAM_CONNECTED,
    CHANGE_FEED_STREAM_DROPPED,
    CHANGE_FEED_TITLE,
    HELD_BACK_EFFECT,
    HELD_BACK_STATE,
} from './constants.js';
import type { ChangeFeedInput } from './types.js';
import { MapReadiness } from '../../../map/types.js';
import { formatUnixSeconds } from '../../../utils/format.utils.js';
import { renderPanel } from '../../../utils/panel.utils.js';

function isLive(readiness: MapReadiness, socketConnected: boolean): boolean {
    return readiness === MapReadiness.Ready && socketConnected;
}

function mapState(readiness: MapReadiness, socketConnected: boolean): string {
    return isLive(readiness, socketConnected) ? CHANGE_FEED_MAP_LIVE : HELD_BACK_STATE[readiness];
}

function effect(readiness: MapReadiness, socketConnected: boolean): string {
    return isLive(readiness, socketConnected) ? CHANGE_FEED_LIVE_EFFECT : HELD_BACK_EFFECT[readiness];
}

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
