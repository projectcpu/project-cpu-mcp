import { createHash, randomBytes } from 'node:crypto';

export function randomUrlPart(): string {
    return randomBytes(32).toString('base64url');
}

export function pkceChallenge(verifier: string): string {
    return createHash('sha256').update(verifier).digest('base64url');
}

export function isPbxk1(value: string): boolean {
    return /^pbxk1\.[A-Za-z0-9_-]{16,}$/.test(value);
}

export function oauthError(message: string): Error {
    return new Error(`PAYBOX_AUTH_FAILED: ${message}`);
}
