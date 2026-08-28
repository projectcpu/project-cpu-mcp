import { describe, expect, it } from 'vitest';

import pkg from '../../../package.json' with { type: 'json' };

describe('Paybox operator documentation packaging', () => {
    it('ships the linked operator guide and release checklist in the npm package', () => {
        expect(pkg.files).toContain('docs');
    });
});
