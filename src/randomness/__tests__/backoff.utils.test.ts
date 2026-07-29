import { describe, expect, it } from 'vitest';

import { backoffDelayMs } from '../backoff.utils.js';

describe('backoffDelayMs', () => {
    it('waits a minute after the first failure', () => {
        expect(backoffDelayMs(1)).toBe(60_000);
    });

    it('doubles the wait with every further failure', () => {
        expect([2, 3, 4].map(backoffDelayMs)).toEqual([120_000, 240_000, 480_000]);
    });

    it('stops growing at a quarter of an hour', () => {
        expect(backoffDelayMs(5)).toBe(900_000);
        expect(backoffDelayMs(50)).toBe(900_000);
    });
});
