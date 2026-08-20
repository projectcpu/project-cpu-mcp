import {
    CHANGE_FEED_DOWN_EFFECT,
    CHANGE_FEED_LABELS,
    CHANGE_FEED_LIVE_EFFECT,
    CHANGE_FEED_SOURCE,
    CHANGE_FEED_STATE_DOWN,
    CHANGE_FEED_STATE_LIVE,
    CHANGE_FEED_TITLE,
} from './constants.js';
import type { ChangeFeedInput } from './types.js';
import { formatUnixSeconds } from '../../../utils/format.utils.js';
import { renderPanel } from '../../../utils/panel.utils.js';

export function changeFeedPanel(input: ChangeFeedInput): string {
    const labels = CHANGE_FEED_LABELS;
    const { reachable, reason } = input.health;

    return renderPanel({
        title: CHANGE_FEED_TITLE,
        rows: [
            [
                { label: labels.source, value: CHANGE_FEED_SOURCE },
                { label: labels.state, value: reachable ? CHANGE_FEED_STATE_LIVE : CHANGE_FEED_STATE_DOWN },
            ],
            [
                { label: labels.since, value: `v${input.since}` },
                { label: labels.changed, value: `${input.changes.changedCount}` },
                { label: labels.recorded, value: `v${input.changes.version}` },
                { label: labels.clock, value: formatUnixSeconds(input.changes.serverTime) },
            ],
            [{ label: labels.reason, value: reachable ? null : reason }],
            [{ label: labels.effect, value: reachable ? CHANGE_FEED_LIVE_EFFECT : CHANGE_FEED_DOWN_EFFECT }],
        ],
    });
}
