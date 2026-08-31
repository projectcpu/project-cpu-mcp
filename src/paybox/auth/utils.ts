import { createHash, randomBytes } from 'node:crypto';

import { PayboxAuthFlowError } from '../errors.js';
import { classifiedPayboxHttpStatus } from '../sdk/utils.js';
import { PayboxRequestContext } from '../types.js';

export function randomUrlPart(): string {
    return randomBytes(32).toString('base64url');
}

export function pkceChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
}

export function oauthError(_message: string): Error {
    return new PayboxAuthFlowError();
}

export function oauthTokenError(status: number): Error {
    return classifiedPayboxHttpStatus(status, PayboxRequestContext.OAuthToken);
}
