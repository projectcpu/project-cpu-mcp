import { createHash, randomBytes } from 'node:crypto';

import { credsFromToken } from '@paybox-sh/sdk';

import { OAUTH_CONFIRMED_AUTH_HTTP_STATUSES } from './auth-flow.constants.js';
import { PAYBOX_KEY_PREFIX } from './constants.js';
import { PayboxAuthInvalidError } from './errors.js';

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

export function oauthTokenError(status: number): Error {
    if (OAUTH_CONFIRMED_AUTH_HTTP_STATUSES.has(status)) {
        return new PayboxAuthInvalidError('Paybox OAuth authorization was rejected.');
    }
    return oauthError(`token exchange returned ${status}`);
}
