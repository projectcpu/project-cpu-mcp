import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { MarketWaitBudget } from '../budget.js';
import { currentMarketWaitBudget, runWithMarketWaitBudget } from '../budget.scope.js';
import { waitOnInvocationBudget } from '../budget.utils.js';
import { MARKET_RETRY_BUDGET_MS } from '../constants.js';
import { MarketWaitRefusal } from '../types.js';

const NOW_SECONDS = 1_800_000_000;

function budget(deadlineAtSeconds: number | null = null): MarketWaitBudget {
    return new MarketWaitBudget({ totalMs: MARKET_RETRY_BUDGET_MS, deadlineAtSeconds });
}

describe('MarketWaitBudget', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('draws every wait down from the one total, so the sum of the waits cannot exceed it', async () => {
        const open = budget();

        await vi.advanceTimersByTimeAsync(0);
        await Promise.all([open.wait(40_000), vi.advanceTimersByTimeAsync(40_000)]);

        expect(open.remainingMs).toBe(20_000);
        expect(open.refuse(20_000)).toBeNull();
        expect(open.refuse(20_001)).toBe(MarketWaitRefusal.BudgetSpent);
    });

    it('refuses a wait that would carry the caller past the effective deadline', () => {
        const open = budget(NOW_SECONDS + 30);

        expect(open.refuse(29_000)).toBeNull();
        expect(open.refuse(30_000)).toBe(MarketWaitRefusal.DeadlineWouldPass);
    });

    it('only ever narrows the deadline, so a later prepared order cannot extend an earlier one', () => {
        const open = budget(NOW_SECONDS + 30);

        open.narrowDeadlineSeconds(NOW_SECONDS + 900);
        expect(open.deadlineAtSeconds).toBe(NOW_SECONDS + 30);

        open.narrowDeadlineSeconds(NOW_SECONDS + 10);
        expect(open.deadlineAtSeconds).toBe(NOW_SECONDS + 10);
    });

    it('clips a wait it cannot fully afford instead of overspending the total', async () => {
        const open = budget();

        await Promise.all([open.wait(55_000), vi.advanceTimersByTimeAsync(55_000)]);
        const [clipped] = await Promise.all([open.waitAtMost(10_000), vi.advanceTimersByTimeAsync(10_000)]);

        expect(clipped).toBe(5_000);
        expect(open.remainingMs).toBe(0);
    });

    it('clips a wait at the effective deadline instead of sleeping past the order it prepared', async () => {
        const open = budget(NOW_SECONDS + 4);

        const [clipped] = await Promise.all([open.waitAtMost(10_000), vi.advanceTimersByTimeAsync(10_000)]);

        expect(clipped).toBe(4_000);
        expect(open.remainingMs).toBe(MARKET_RETRY_BUDGET_MS - 4_000);
    });

    it('lets the snapshot wait inside an invocation draw on that invocation budget', async () => {
        const startedAt = Date.now();

        await runWithMarketWaitBudget(async () => {
            const open = currentMarketWaitBudget();
            await Promise.all([waitOnInvocationBudget(50_000), vi.advanceTimersByTimeAsync(50_000)]);
            const [clipped] = await Promise.all([waitOnInvocationBudget(50_000), vi.advanceTimersByTimeAsync(10_000)]);

            expect(clipped).toBe(10_000);
            expect(open?.remainingMs).toBe(0);
        });

        expect(Date.now() - startedAt).toBe(MARKET_RETRY_BUDGET_MS);
    });
});
