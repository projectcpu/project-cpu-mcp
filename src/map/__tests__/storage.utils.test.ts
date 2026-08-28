import { describe, expect, it } from 'vitest';

import { makeConfig } from '../../services/__tests__/service-fakes.js';
import { storageCapsByResource } from '../reader.utils.js';
import { configuredStorageCap } from '../storage.utils.js';
import type { ProcessProjectionConfig } from '../types.js';

function config(storageCapsByResource: ProcessProjectionConfig['storageCapsByResource']): ProcessProjectionConfig {
    return { craftOutputsByRecipe: {}, storageCapsByResource };
}

describe('configuredStorageCap', () => {
    it('keeps a missing WCPU row uncapped and gives every other missing resource no room', () => {
        const empty = config({});

        expect(configuredStorageCap(1, false, empty)).toBeNull();
        expect(configuredStorageCap(5, false, empty)).toBe(0n);
    });

    it('preserves configured zero as a real cap for non-WCPU resources', () => {
        const zero = config({ 5: { cellCap: 0n, hubCap: 0n } });

        expect(configuredStorageCap(5, false, zero)).toBe(0n);
        expect(configuredStorageCap(5, true, zero)).toBe(0n);
    });
});

describe('storageCapsByResource', () => {
    it('maps zero to uncapped only for WCPU', () => {
        const base = makeConfig();
        const caps = storageCapsByResource({
            ...base,
            storage: {
                caps: [
                    { resourceId: 1, cellCap: 0, hubCap: 0 },
                    { resourceId: 5, cellCap: 0, hubCap: 0 },
                ],
            },
        });

        expect(caps[1]).toEqual({ cellCap: null, hubCap: null });
        expect(caps[5]).toEqual({ cellCap: 0n, hubCap: 0n });
    });
});
