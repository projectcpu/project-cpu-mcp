export const OAUTH_DISCOVERY_PATH = '/.well-known/oauth-authorization-server';
export const OAUTH_SCOPE = 'mcp offline_access';
export const PAYBOX_OAUTH_CLIENT_NAME = 'Project CPU MCP';
export const OAUTH_DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';
export const OAUTH_DEVICE_REDIRECT_URI = 'http://127.0.0.1/device';
export const OAUTH_DEVICE_PENDING_ERROR = 'authorization_pending';
export const OAUTH_DEVICE_SLOW_DOWN_ERROR = 'slow_down';
export const DEFAULT_DEVICE_POLL_INTERVAL_SECONDS = 5;
export const DEFAULT_DEVICE_START_TIMEOUT_MS = 5 * 60 * 1000;
export const SIGNING_KEY_FORM_OPEN_DELAY_MS = 5000;
export const DEVICE_SLOW_DOWN_INCREMENT_SECONDS = 5;
export const OAUTH_CONFIRMED_AUTH_HTTP_STATUSES = new Set([400, 401, 403]);
export const LOOPBACK_HOST = '127.0.0.1';
export const LOOPBACK_KEY_PREFIX = '/oauth/key/';
export const PAYBOX_AGENT_KEY_PATH = '/agent-key';
export const KEY_BODY_LIMIT_BYTES = 4096;
export const HTML_HEADERS = {
    'cache-control': 'no-store',
    'content-security-policy':
        "default-src 'none'; style-src 'unsafe-inline'; font-src data:; form-action 'self'; base-uri 'none'",
    'content-type': 'text/html; charset=utf-8',
};
