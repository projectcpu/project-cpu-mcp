import { type Address } from 'viem';
import { describe, expect, it } from 'vitest';

import { RandomnessKind } from '../../api/types.js';
import { PushRandomnessStrategy } from '../push.strategy.js';

const SOURCE = '0x00000000000000000000000000000000000000a1' as Address;

describe('PushRandomnessStrategy', () => {
    it('carries the push kind and the source the draw comes from', () => {
        const strategy = new PushRandomnessStrategy({ source: SOURCE });

        expect(strategy.kind).toBe(RandomnessKind.ENTROPY);
        expect(strategy.source).toBe(SOURCE);
    });

    it('quotes nothing of its own, so nothing can fund a reveal from a second price', () => {
        const strategy = new PushRandomnessStrategy({ source: SOURCE });

        expect(Object.getOwnPropertyNames(Object.getPrototypeOf(strategy))).toEqual(['constructor']);
    });
});
