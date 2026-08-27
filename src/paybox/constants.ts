export const PAYBOX_AUTH_FILE = 'paybox.json';
export const PAYBOX_SCHEMA_VERSION = 1;
export const PAYBOX_DIR_MODE = 0o700;
export const PAYBOX_FILE_MODE = 0o600;
export const PAYBOX_CALLBACK_BODY_LIMIT = 4096;
export const PAYBOX_CALLBACK_TIMEOUT_MS = 5 * 60 * 1000;
export const PAYBOX_KEY_PREFIX = 'pbxk1.';
export const PAYBOX_AUTH_REQUIRED_INSTRUCTIONS =
    'Open the authorization URL in a local browser to continue Paybox authentication.';
export const PAYBOX_FULL_ACCESS_WALLET_INSTRUCTIONS =
    'Create or grant an EVM Wallet with autonomous access in Paybox, then call cpu_authenticate again.';
