import { describe, expect, it } from 'vitest';

import { computeBatchSchedule, toProcessProgress, type BatchSchedule } from '../process.utils.js';

const BASE = { durationSec: 180, batches: 10, claimedBatches: 0, startAtSec: 1000 };

const at = (nowSec: number, overrides: Partial<typeof BASE> = {}) =>
    computeBatchSchedule({ ...BASE, ...overrides, nowSec });

describe('computeBatchSchedule', () => {
    it('counts only whole cycles, ignoring time into the current one', () => {
        const s = at(1000 + 2 * 180 + 30);
        expect(s.maturedBatches).toBe(2);
        expect(s.remainingBatches).toBe(10);
        expect(s.nextBatchAtSec).toBe(1000 + 3 * 180);
    });

    it('matures a cycle exactly on its boundary', () => {
        expect(at(1000 + 3 * 180).maturedBatches).toBe(3);
    });

    it('clamps a future cursor to zero elapsed', () => {
        const s = at(500);
        expect(s.maturedBatches).toBe(0);
        expect(s.nextBatchAtSec).toBe(1180);
    });

    it('measures cycles from the advanced cursor rather than subtracting claimedBatches twice', () => {
        const s = at(1000 + 5 * 180, { claimedBatches: 3, startAtSec: 1000 + 3 * 180 });
        expect(s.maturedBatches).toBe(2);
        expect(s.remainingBatches).toBe(7);
        expect(s.endsAtSec).toBe(1000 + 3 * 180 + 7 * 180);
    });

    it('never matures past the batches left to run, however long it waits', () => {
        const s = at(1000 + 999 * 180, { claimedBatches: 8 });
        expect(s.maturedBatches).toBe(2);
        expect(s.nextBatchAtSec).toBeNull();
    });

    it('accrues nothing on a row that lost its duration rather than answering Infinity', () => {
        const s = at(9999, { durationSec: 0 });
        expect(s.maturedBatches).toBe(0);
        expect(s.endsAtSec).toBe(1000);
    });

    it('leaves a job predating bounded mining (zero batches) nothing to run', () => {
        const s = at(9999, { batches: 0 });
        expect(s.maturedBatches).toBe(0);
        expect(s.remainingBatches).toBe(0);
        expect(s.endsAtSec).toBe(1000);
        expect(s.nextBatchAtSec).toBeNull();
    });
});

const schedule = (overrides: Partial<BatchSchedule> = {}): BatchSchedule => ({
    maturedBatches: 2,
    remainingBatches: 10,
    endsAtSec: 2800,
    nextBatchAtSec: 1540,
    ...overrides,
});

describe('toProcessProgress', () => {
    it('counts what a claim would bank, not what merely matured', () => {
        const p = toProcessProgress({
            schedule: schedule(),
            claimedBatches: 3,
            settledBatches: 2,
            depleted: false,
            stalled: false,
        });
        expect(p).toEqual({
            completedBatches: 5,
            claimableBatches: 2,
            isFinished: false,
            endsAtSec: 2800,
            nextBatchAtSec: 1540,
        });
    });

    it('does not call a stalled job finished, however far past its schedule the clock is', () => {
        const p = toProcessProgress({
            schedule: schedule({ maturedBatches: 15, remainingBatches: 10, nextBatchAtSec: null }),
            claimedBatches: 0,
            settledBatches: 0,
            depleted: false,
            stalled: true,
        });
        expect(p.isFinished).toBe(false);
        expect(p.completedBatches).toBe(0);
        expect(p.claimableBatches).toBe(0);
        expect(p.nextBatchAtSec).toBeNull();
    });

    it('finishes when the claim would settle the last of the schedule', () => {
        const p = toProcessProgress({
            schedule: schedule({ maturedBatches: 10, remainingBatches: 10 }),
            claimedBatches: 0,
            settledBatches: 10,
            depleted: false,
            stalled: false,
        });
        expect(p.isFinished).toBe(true);
        expect(p.nextBatchAtSec).toBeNull();
    });

    it('finishes on a drained deposit even with schedule left', () => {
        const p = toProcessProgress({
            schedule: schedule({ maturedBatches: 2, remainingBatches: 10 }),
            claimedBatches: 0,
            settledBatches: 2,
            depleted: true,
            stalled: false,
        });
        expect(p.isFinished).toBe(true);
        expect(p.nextBatchAtSec).toBeNull();
    });

    it('reports a room-capped claim as unfinished — the rest of the schedule survives', () => {
        const p = toProcessProgress({
            schedule: schedule({ maturedBatches: 10, remainingBatches: 10 }),
            claimedBatches: 0,
            settledBatches: 5,
            depleted: false,
            stalled: false,
        });
        expect(p.isFinished).toBe(false);
        expect(p.completedBatches).toBe(5);
    });
});
