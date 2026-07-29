import {
    BEACON_RETRY_INTERVAL_MS,
    BEACON_WAIT_BUDGET_FACTOR,
    BEACON_WAIT_CEILING_MS,
    MS_PER_SECOND,
} from './constants.js';
import type { BeaconRoundClock, BeaconWaitPlan } from './types.js';

export function roundReleaseAt(clock: BeaconRoundClock, round: bigint): number {
    return clock.genesis + Number(round - 1n) * clock.period;
}

export function beaconWaitBudgetMs(releaseAt: number, nowSec: number): number {
    const untilRelease = BEACON_WAIT_BUDGET_FACTOR * (releaseAt - nowSec) * MS_PER_SECOND;
    return Math.min(Math.max(untilRelease, BEACON_RETRY_INTERVAL_MS), BEACON_WAIT_CEILING_MS);
}

export function planBeaconWait(clock: BeaconRoundClock, round: bigint, nowSec: number): BeaconWaitPlan {
    const releaseAt = roundReleaseAt(clock, round);
    return {
        releaseAt,
        budgetMs: beaconWaitBudgetMs(releaseAt, nowSec),
        retryDelayMs: BEACON_RETRY_INTERVAL_MS,
    };
}
