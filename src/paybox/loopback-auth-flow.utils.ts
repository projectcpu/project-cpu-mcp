import { oauthError } from './auth-flow.utils.js';
import type { OAuthTokenResponse } from './types.js';

export function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function urlField(value: Record<string, unknown>, name: string): string {
    const field = nonEmptyString(value, name);
    try {
        new URL(field);
    } catch {
        throw oauthError(`invalid ${name}`);
    }
    return field;
}

export function nonEmptyString(value: Record<string, unknown>, name: string): string {
    const field = value[name];
    if (typeof field !== 'string' || field.length === 0) throw oauthError(`response missing ${name}`);
    return field;
}

export function tokenResponse(value: unknown): OAuthTokenResponse {
    if (!isObject(value) || typeof value.access_token !== 'string' || value.access_token.length === 0) {
        throw oauthError('malformed token response');
    }
    if (
        value.refresh_token !== undefined &&
        (typeof value.refresh_token !== 'string' || value.refresh_token.length === 0)
    ) {
        throw oauthError('malformed token response');
    }
    if (value.resource !== undefined && (typeof value.resource !== 'string' || value.resource.length === 0)) {
        throw oauthError('malformed token response');
    }
    if (
        value.expires_in !== undefined &&
        (typeof value.expires_in !== 'number' || !Number.isFinite(value.expires_in) || value.expires_in < 0)
    ) {
        throw oauthError('malformed token response');
    }
    return {
        accessToken: value.access_token,
        refreshToken: value.refresh_token ?? null,
        resource: value.resource ?? null,
        expiresAt: value.expires_in === undefined ? null : Date.now() + value.expires_in * 1000,
    };
}

export function formKey(body: string): string | null {
    const value = new URLSearchParams(body).get('key');
    return value === null ? null : value;
}
