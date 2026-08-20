import { describe, expect, it } from 'vitest';

import { parseBooleanEnv } from '../boolean-env.utils.js';

describe('parseBooleanEnv', () => {
    it('returns the default when the value is unset (null)', () => {
        expect(parseBooleanEnv(null, false)).toBe(false);
        expect(parseBooleanEnv(null, true)).toBe(true);
    });

    it('returns the default when the value is an empty string', () => {
        expect(parseBooleanEnv('', false)).toBe(false);
        expect(parseBooleanEnv('', true)).toBe(true);
    });

    it('maps the literal string "true" to true', () => {
        expect(parseBooleanEnv('true', false)).toBe(true);
    });

    it('maps the literal string "false" to false, even when the default is true', () => {
        expect(parseBooleanEnv('false', true)).toBe(false);
    });

    it('is case-insensitive and trims whitespace', () => {
        expect(parseBooleanEnv('  TRUE  ', false)).toBe(true);
        expect(parseBooleanEnv('False', true)).toBe(false);
    });

    it('falls back to the default for a garbage value, never silently becoming true', () => {
        expect(parseBooleanEnv('yes', false)).toBe(false);
        expect(parseBooleanEnv('1', false)).toBe(false);
        expect(parseBooleanEnv('nonsense', false)).toBe(false);
        expect(parseBooleanEnv('nonsense', true)).toBe(true);
    });
});
