import { describe, expect, it } from 'vitest';

import { REVEAL_POLL_TIMEOUT_MS } from '../../services/reveal.constants.js';
import { BEACON_RETRY_INTERVAL_MS, BEACON_WAIT_CEILING_MS } from '../constants.js';
import { beaconWaitBudgetMs, planBeaconWait, roundReleaseAt } from '../round.utils.js';
import type { BeaconRoundClock } from '../types.js';

const GENESIS = 1_700_000_000;
const FAST: BeaconRoundClock = { genesis: GENESIS, period: 3 };
const SLOW: BeaconRoundClock = { genesis: GENESIS, period: 30 };

describe('roundReleaseAt', () => {
    it('releases the first round at the genesis itself', () => {
        expect(roundReleaseAt(FAST, 1n)).toBe(GENESIS);
        expect(roundReleaseAt(SLOW, 1n)).toBe(GENESIS);
    });

    it('releases a later round a whole number of periods after the genesis', () => {
        expect(roundReleaseAt(FAST, 101n)).toBe(GENESIS + 100 * 3);
        expect(roundReleaseAt(SLOW, 101n)).toBe(GENESIS + 100 * 30);
    });

    it('reads the round as the on-chain counter hands it over, without losing whole seconds', () => {
        expect(roundReleaseAt(SLOW, 4_211n)).toBe(GENESIS + 4_210 * 30);
    });
});

describe('beaconWaitBudgetMs', () => {
    it('budgets twice the wait left until the round is released', () => {
        expect(beaconWaitBudgetMs(GENESIS + 10, GENESIS)).toBe(20_000);
    });

    it('clamps the budget up to the retry step for a round that is already due', () => {
        expect(beaconWaitBudgetMs(GENESIS, GENESIS)).toBe(BEACON_RETRY_INTERVAL_MS);
        expect(beaconWaitBudgetMs(GENESIS, GENESIS + 600)).toBe(BEACON_RETRY_INTERVAL_MS);
    });

    it('clamps the budget down to the ceiling for a round far ahead', () => {
        expect(beaconWaitBudgetMs(GENESIS + 600, GENESIS)).toBe(BEACON_WAIT_CEILING_MS);
    });

    it('holds the ceiling at the same wait this client already grants a reveal', () => {
        expect(BEACON_WAIT_CEILING_MS).toBe(REVEAL_POLL_TIMEOUT_MS);
    });

    it('takes the reference now as given rather than reading a clock of its own', () => {
        expect(beaconWaitBudgetMs(GENESIS + 10, GENESIS + 5)).toBe(10_000);
        expect(beaconWaitBudgetMs(GENESIS + 10, GENESIS - 5)).toBe(30_000);
    });
});

describe('planBeaconWait', () => {
    it('carries the release time, the budget and the step together', () => {
        expect(planBeaconWait(SLOW, 3n, GENESIS + 50)).toEqual({
            releaseAt: GENESIS + 60,
            budgetMs: 20_000,
            retryDelayMs: BEACON_RETRY_INTERVAL_MS,
        });
    });

    it('steps at the same interval whatever the beacon period, while the budget follows the period', () => {
        const fast = planBeaconWait(FAST, 3n, GENESIS);
        const slow = planBeaconWait(SLOW, 3n, GENESIS);

        expect(fast.retryDelayMs).toBe(slow.retryDelayMs);
        expect(fast.retryDelayMs).toBe(BEACON_RETRY_INTERVAL_MS);
        expect(fast.budgetMs).toBe(12_000);
        expect(slow.budgetMs).toBe(BEACON_WAIT_CEILING_MS);
    });

    it('floors the budget at a whole retry step, which is the wait one more look costs', () => {
        const plan = planBeaconWait(FAST, 1n, GENESIS + 3_600);

        expect(plan.budgetMs).toBe(plan.retryDelayMs);
        expect(plan.budgetMs).toBeGreaterThanOrEqual(BEACON_RETRY_INTERVAL_MS);
    });
});
