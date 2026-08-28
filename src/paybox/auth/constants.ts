export const OAUTH_DISCOVERY_PATH = '/.well-known/oauth-authorization-server';
export const OAUTH_SCOPE = 'mcp offline_access';
export const PAYBOX_OAUTH_CLIENT_NAME = 'Project CPU MCP';
export const OAUTH_CONFIRMED_AUTH_HTTP_STATUSES = new Set([400, 401, 403]);
export const LOOPBACK_HOST = '127.0.0.1';
export const LOOPBACK_CALLBACK_PREFIX = '/oauth/callback/';
export const LOOPBACK_KEY_PREFIX = '/oauth/key/';
export const PAYBOX_AGENT_KEY_PATH = '/agent-key';
export const DEFAULT_LOOPBACK_TIMEOUT_MS = 5 * 60 * 1000;
export const KEY_BODY_LIMIT_BYTES = 4096;
export const HTML_HEADERS = {
    'cache-control': 'no-store',
    'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; font-src data:; form-action 'self'; base-uri 'none'",
    'content-type': 'text/html; charset=utf-8',
};
