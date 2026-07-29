export const REDACTED = '[REDACTED]';

/**
 * Object keys whose values are redacted recursively. Matched case-insensitively
 * after lowercasing the key (so `privateKey`, `PRIVATE_KEY`, `private_key` all match).
 */
export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
    'privatekey',
    'secret',
    'mnemonic',
    'seedphrase',
    'jwt',
    'refreshtoken',
    'sessionprivatekey',
    'apikey',
    'accesstoken',
    'authorization',
]);

/**
 * Any `0x` followed by exactly 64 hex chars — matches 32-byte private keys.
 * This catches raw keys that slipped into log strings.
 */
export const PRIVATE_KEY_PATTERN = /\b0x[a-fA-F0-9]{64}\b/g;

/**
 * JWT in compact serialization: three base64url segments separated by dots,
 * with the first segment starting with `eyJ` (base64 of `{"`).
 */
export const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g;
