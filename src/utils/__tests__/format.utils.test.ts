import { describe, expect, it } from 'vitest';

import { bpToPercent, percentToBp } from '../format.utils.js';

describe('percentToBp', () => {
    it('maps whole and fractional percents onto basis points', () => {
        expect(percentToBp(0)).toBe(0);
        expect(percentToBp(0.01)).toBe(1);
        expect(percentToBp(2.5)).toBe(250);
        expect(percentToBp(50)).toBe(5000);
    });

    it('is float-safe — 0.29 lands on a whole bp despite binary rounding noise', () => {
        expect(percentToBp(0.29)).toBe(29);
        expect(percentToBp(1.11)).toBe(111);
    });

    it('rejects a rate finer than one basis point', () => {
        expect(() => percentToBp(0.005)).toThrow(/basis point/i);
        expect(() => percentToBp(0.004)).toThrow(/basis point/i);
        expect(() => percentToBp(2.501)).toThrow(/basis point/i);
    });
});

describe('bpToPercent', () => {
    it('maps basis points back onto percents', () => {
        expect(bpToPercent(0)).toBe(0);
        expect(bpToPercent(1)).toBe(0.01);
        expect(bpToPercent(250)).toBe(2.5);
        expect(bpToPercent(5000)).toBe(50);
    });

    it('round-trips with percentToBp', () => {
        for (const bp of [0, 1, 29, 111, 250, 5000]) {
            expect(percentToBp(bpToPercent(bp))).toBe(bp);
        }
    });
});
