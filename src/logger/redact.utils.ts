import { JWT_PATTERN, PRIVATE_KEY_PATTERN, REDACTED, SENSITIVE_KEYS } from './constants.js';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Normalize a key for comparison: lowercase + drop non-alphanumeric so
 *  `PRIVATE_KEY`, `privateKey`, `private-key` all match a single entry. */
function normalizeKey(key: string): string {
    return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Redacts raw private-key-shaped and JWT-shaped substrings inside a log message.
 */
export function redactString(input: string): string {
    return input.replace(PRIVATE_KEY_PATTERN, REDACTED).replace(JWT_PATTERN, REDACTED);
}

/**
 * Recursively redacts sensitive fields in arbitrary log metadata.
 *
 * - Keys matching `SENSITIVE_KEYS` (case-insensitive) → replaced with `[REDACTED]`
 * - String values are passed through `redactString` to scrub raw hex / JWTs
 * - Arrays / plain objects are walked recursively
 * - Everything else is returned as-is
 */
export function redactValue(value: unknown, keyHint: string | null = null): unknown {
    if (keyHint !== null && SENSITIVE_KEYS.has(normalizeKey(keyHint))) {
        return REDACTED;
    }

    if (Array.isArray(value)) {
        return value.map((item) => redactValue(item));
    }

    if (isPlainObject(value)) {
        const out: Record<string, unknown> = {};
        for (const [key, entry] of Object.entries(value)) {
            out[key] = redactValue(entry, key);
        }
        return out;
    }

    if (typeof value === 'string') {
        return redactString(value);
    }

    return value;
}
