import { createHash, randomBytes } from 'node:crypto';

import { classifiedPayboxHttpStatus } from './sdk.utils.js';
import { PayboxRequestContext } from './types.js';

export function randomUrlPart(): string {
    return randomBytes(32).toString('base64url');
}

export function pkceChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
}

export function oauthError(message: string): Error {
    return new Error(`PAYBOX_AUTH_FAILED: ${message}`);
}

export function oauthTokenError(status: number): Error {
    return classifiedPayboxHttpStatus(status, PayboxRequestContext.OAuthToken);
}
