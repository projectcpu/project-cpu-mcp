import { randomBytes } from 'node:crypto';

import { PayboxAuthFlowError, PayboxAuthInvalidError, PayboxTemporarilyUnavailableError } from '../errors.js';
import { classifiedPayboxHttpStatus } from '../sdk/utils.js';
import { PayboxRequestContext } from '../types.js';

export function randomUrlPart(): string {
    return randomBytes(32).toString('base64url');
}

export function oauthError(_message: string): Error {
    return new PayboxAuthFlowError();
}

export function oauthTokenError(status: number): Error {
    return classifiedPayboxHttpStatus(status, PayboxRequestContext.OAuthToken);
}

export function authAbortError(reason: unknown): Error {
    if (
        reason instanceof PayboxAuthFlowError ||
        reason instanceof PayboxAuthInvalidError ||
        reason instanceof PayboxTemporarilyUnavailableError
    ) {
        return reason;
    }
    return oauthError('cancelled');
}

export function waitForPoll(delayMs: number, signal: AbortSignal): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        if (signal.aborted) {
            reject(authAbortError(signal.reason));
            return;
        }
        const onAbort = () => {
            clearTimeout(timer);
            reject(authAbortError(signal.reason));
        };
        const timer = setTimeout(() => {
            signal.removeEventListener('abort', onAbort);
            resolve();
        }, delayMs);
        signal.addEventListener('abort', onAbort, { once: true });
    });
}
