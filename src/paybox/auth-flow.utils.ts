import { createHash, randomBytes } from 'node:crypto';

import { credsFromToken } from '@paybox-sh/sdk';

import { PAYBOX_KEY_PREFIX } from './constants.js';

export function randomUrlPart(): string {
    return randomBytes(32).toString('base64url');
}

export function pkceChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
}

export function isPbxk1(value: string): boolean {
    if (value !== value.trim() || !value.startsWith(PAYBOX_KEY_PREFIX)) return false;
    try {
        credsFromToken(value);
        return true;
    } catch {
        return false;
    }
}

export function oauthError(message: string): Error {
    return new Error(`PAYBOX_AUTH_FAILED: ${message}`);
}
