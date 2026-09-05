import { PAYBOX_AGENT_KEY_PATH } from './constants.js';
import { isObject } from './oauth-response.utils.js';
import { managementUrlFromBaseUrl } from '../sdk/utils.js';

export function agentClientId(accessToken: string): string | null {
    const payload = accessToken.split('.')[1];
    if (payload === undefined) return null;
    try {
        const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!isObject(claims)) return null;
        return typeof claims.cid === 'string' && claims.cid.length > 0 ? claims.cid : null;
    } catch {
        return null;
    }
}

export function agentKeyProvisioningUrl(baseUrl: string, accessToken: string): string | null {
    const appBase = managementUrlFromBaseUrl(baseUrl);
    const clientId = agentClientId(accessToken);
    if (appBase === null || clientId === null) return null;
    const url = new URL(PAYBOX_AGENT_KEY_PATH, appBase);
    url.searchParams.set('client_id', clientId);
    return url.toString();
}
