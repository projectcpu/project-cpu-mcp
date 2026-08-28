import { PayboxError } from '@paybox-sh/sdk';
import { getAddress, isAddress, type Hex } from 'viem';

import { PayboxAuthInvalidError, PayboxOperationDeniedError, PayboxTemporarilyUnavailableError } from './errors.js';
import {
    PAYBOX_AUTONOMOUS_MODE,
    PAYBOX_CONFIRMED_AUTH_HTTP_STATUSES,
    PAYBOX_DENIED_STATUS,
    PAYBOX_EIP155_CHAIN_ID_PATTERN,
    PAYBOX_REFRESH_HTTP_STATUS_PATTERN,
    PAYBOX_MANAGEMENT_HOST_BY_API_HOST,
    PAYBOX_SIGNATURE_OUTPUT,
    PAYBOX_SUCCESS_STATUS,
    PAYBOX_WALLET_TYPE,
} from './sdk.constants.js';
import {
    PayboxRequestContext,
    PayboxResetCause,
    type EligiblePayboxGrant,
    type EligiblePayboxGrantList,
} from './types.js';

export function autonomousEvmGrants(value: unknown, baseUrl: string): EligiblePayboxGrantList {
    return {
        grants: grantRows(value).flatMap(normalizeGrant),
        managementUrl: managementUrlFromBaseUrl(baseUrl),
    };
}

export function classifiedPayboxError(error: unknown, context: PayboxRequestContext): Error {
    const status = payboxHttpStatus(error, context);
    if (status !== null) return classifiedPayboxHttpStatus(status, context, error);
    if (isNetworkOrTimeoutError(error)) {
        return new PayboxTemporarilyUnavailableError({ cause: error });
    }
    return error instanceof Error ? error : new Error('Paybox request failed.');
}

export function classifiedPayboxHttpStatus(
    status: number,
    context: PayboxRequestContext,
    cause: unknown = null,
): Error {
    const options: ErrorOptions | null = cause === null ? null : { cause };
    if (isConfirmedAuthenticationStatus(status, context)) {
        return new PayboxAuthInvalidError(
            'Paybox authentication authority was rejected.',
            resetCause(context),
            options,
        );
    }
    if (status === 429 || status >= 500) {
        return new PayboxTemporarilyUnavailableError(options);
    }
    return new Error('Paybox request failed.', options ?? undefined);
}

export function signatureFromResponse(value: unknown, credentialId: string): Hex {
    if (isRecord(value) && value.status === PAYBOX_DENIED_STATUS) {
        throw new PayboxOperationDeniedError();
    }
    if (!isRecord(value) || value.status !== PAYBOX_SUCCESS_STATUS || !isRecord(value.output)) {
        throw new Error('Paybox message signing did not complete successfully.');
    }
    const output = value.output;
    if (
        output.output_type !== PAYBOX_SIGNATURE_OUTPUT ||
        output.credential_id !== credentialId ||
        !isHex(output.value)
    ) {
        throw new Error('Paybox returned an invalid message signature.');
    }
    return output.value;
}

export function serializedTransactionFromResponse(value: unknown, credentialId: string): Hex {
    if (isRecord(value) && value.status === PAYBOX_DENIED_STATUS) {
        throw new PayboxOperationDeniedError();
    }
    if (!isRecord(value) || value.status !== PAYBOX_SUCCESS_STATUS || !isRecord(value.output)) {
        throw new Error('Paybox transaction signing did not complete successfully.');
    }
    const output = value.output;
    if (
        output.output_type !== PAYBOX_SIGNATURE_OUTPUT ||
        output.credential_id !== credentialId ||
        !isSerializedTransaction(output.value)
    ) {
        throw new Error('Paybox returned an invalid serialized transaction.');
    }
    return output.value;
}

function payboxHttpStatus(error: unknown, context: PayboxRequestContext): number | null {
    if (error instanceof PayboxError) return error.status;
    if (context !== PayboxRequestContext.Refresh || !(error instanceof Error)) return null;
    const match = PAYBOX_REFRESH_HTTP_STATUS_PATTERN.exec(error.message);
    return match === null ? null : Number(match[1]);
}

function isConfirmedAuthenticationStatus(status: number, context: PayboxRequestContext): boolean {
    if (context === PayboxRequestContext.Authenticated) {
        return PAYBOX_CONFIRMED_AUTH_HTTP_STATUSES.has(status);
    }
    if (context === PayboxRequestContext.Refresh || context === PayboxRequestContext.OAuthToken) {
        return status === 400 || PAYBOX_CONFIRMED_AUTH_HTTP_STATUSES.has(status);
    }
    return false;
}

function resetCause(context: PayboxRequestContext): PayboxResetCause {
    if (context === PayboxRequestContext.Refresh) return PayboxResetCause.InvalidRefresh;
    if (context === PayboxRequestContext.OAuthToken) return PayboxResetCause.OAuthRejected;
    return PayboxResetCause.AuthenticatedRequestRejected;
}

function isNetworkOrTimeoutError(error: unknown): boolean {
    if (error instanceof TypeError) return true;
    if (!(error instanceof Error)) return false;
    if (error.name === 'AbortError' || error.name === 'TimeoutError') return true;
    const code = (error as Error & { code: unknown }).code;
    return (
        code === 'ECONNREFUSED' ||
        code === 'ECONNRESET' ||
        code === 'ENOTFOUND' ||
        code === 'EAI_AGAIN' ||
        code === 'ETIMEDOUT'
    );
}

function grantRows(value: unknown): Array<unknown> {
    if (Array.isArray(value)) return value;
    if (!isRecord(value)) throw new Error('Paybox returned an invalid grant list.');
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === 'credentials' && Array.isArray(value.credentials)) {
        return value.credentials;
    }
    throw new Error('Paybox returned an invalid grant list.');
}

function normalizeGrant(value: unknown): Array<EligiblePayboxGrant> {
    if (!isRecord(value)) return [];
    if (!isRecord(value.credential) || !isRecord(value.grant)) return [];
    const credential = value.credential;
    const grant = value.grant;
    if (
        credential.credential_type !== PAYBOX_WALLET_TYPE ||
        credential.disabled_at !== null ||
        grant.approval_mode !== PAYBOX_AUTONOMOUS_MODE ||
        (grant.credential_id !== undefined && grant.credential_id !== credential.id) ||
        typeof credential.id !== 'string' ||
        credential.id.length === 0
    ) {
        return [];
    }
    const metadata = isRecord(credential.metadata) ? credential.metadata : null;
    const address = metadata === null ? null : addressField(metadata);
    if (metadata === null || address === null || !isEvm(metadata)) return [];
    return [
        {
            credentialId: credential.id,
            address: getAddress(address),
            label: displayField(credential.name),
            provider: displayField(credential.provider),
        },
    ];
}

function displayField(value: unknown): string | null {
    return typeof value === 'string' ? value : null;
}

function managementUrlFromBaseUrl(baseUrl: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(baseUrl);
    } catch {
        return null;
    }
    if (
        parsed.protocol !== 'https:' ||
        parsed.username !== '' ||
        parsed.password !== '' ||
        parsed.port !== '' ||
        parsed.pathname !== '/' ||
        parsed.search !== '' ||
        parsed.hash !== ''
    ) {
        return null;
    }
    const managementHost = PAYBOX_MANAGEMENT_HOST_BY_API_HOST[parsed.hostname];
    return managementHost === undefined ? null : `https://${managementHost}`;
}

function addressField(metadata: Record<string, unknown>): string | null {
    const value = metadata.address ?? metadata.wallet_address;
    return typeof value === 'string' && isAddress(value) ? value : null;
}

function isEvm(metadata: Record<string, unknown>): boolean {
    const chain = metadata.chain ?? metadata.chain_type ?? metadata.network;
    return (
        chain === 'evm' ||
        chain === 'ethereum' ||
        (typeof chain === 'string' && PAYBOX_EIP155_CHAIN_ID_PATTERN.test(chain))
    );
}

function isHex(value: unknown): value is Hex {
    return typeof value === 'string' && /^0x[0-9a-fA-F]{130}$/.test(value);
}

function isSerializedTransaction(value: unknown): value is Hex {
    return typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})+$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
