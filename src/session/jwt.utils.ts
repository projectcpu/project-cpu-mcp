import { decodeJwt } from 'jose';

/**
 * Returns true if the JWT's `exp` claim is in the past relative to `nowMs`.
 * JWTs without an `exp` claim are treated as non-expiring — the server decides on 401.
 *
 * Note: this does NOT verify the signature. We trust the token because we stored it
 * ourselves from our own API. For signature verification, use `jose.jwtVerify`.
 */
export function isJwtExpired(jwt: string, nowMs: number = Date.now()): boolean {
    const { exp } = decodeJwt(jwt);

    if (typeof exp !== 'number') {
        return false;
    }

    const nowSeconds = Math.floor(nowMs / 1000);
    return exp <= nowSeconds;
}
