export const PAYBOX_AUTONOMOUS_MODE = 'autonomous';
export const PAYBOX_WALLET_TYPE = 'wallet';
export const PAYBOX_SUCCESS_STATUS = 'success';
export const PAYBOX_SIGNATURE_OUTPUT = 'signature';
export const PAYBOX_EIP155_CHAIN_ID_PATTERN = /^eip155:[0-9]{1,32}$/;
export const PAYBOX_MANAGEMENT_HOST_BY_API_HOST: Readonly<Record<string, string>> = {
    'api.paybox.sh': 'app.paybox.sh',
    'api.paybox.test': 'app.paybox.test',
};
