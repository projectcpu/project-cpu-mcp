export const PAYBOX_AUTONOMOUS_MODE = 'autonomous';
export const PAYBOX_WALLET_TYPE = 'wallet';
export const PAYBOX_SUCCESS_STATUS = 'success';
export const PAYBOX_DENIED_STATUS = 'denied';
export const PAYBOX_SIGNATURE_OUTPUT = 'signature';
export const PAYBOX_EIP155_CHAIN_ID_PATTERN = /^eip155:[0-9]{1,32}$/;
export const PAYBOX_CONFIRMED_AUTH_HTTP_STATUSES = new Set([401, 403]);
export const PAYBOX_INVALID_GRANT_HTTP_STATUS = 400;
export const PAYBOX_RATE_LIMIT_HTTP_STATUS = 429;
export const PAYBOX_SERVER_ERROR_STATUS_MINIMUM = 500;
export const PAYBOX_REFRESH_HTTP_STATUS_PATTERN = /^token refresh failed \(([0-9]{3})\):/u;
export const PAYBOX_TRANSPORT_ERROR_NAMES = new Set(['AbortError', 'TimeoutError']);
export const PAYBOX_TRANSPORT_ERROR_CODES = new Set([
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT',
]);
export const PAYBOX_MANAGEMENT_HOST_BY_API_HOST: Readonly<Record<string, string>> = {
    'api.paybox.sh': 'app.paybox.sh',
    'api.paybox.test': 'app.paybox.test',
};
