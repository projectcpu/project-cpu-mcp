import { PayboxError } from '@paybox-sh/sdk';
import { getAddress, isAddress, type Hex } from 'viem';

import { redactString } from '../../logger/redact.utils.js';
import {
    PayboxAuthFlowError,
    PayboxAuthInvalidError,
    PayboxInvalidOperationArtifactError,
    PayboxOperationDeniedError,
    PayboxOperationIncompleteError,
    PayboxTemporarilyUnavailableError,
} from '../errors.js';
import {
    PAYBOX_AUTONOMOUS_MODE,
    PAYBOX_CONFIRMED_AUTH_HTTP_STATUSES,
    PAYBOX_DENIED_STATUS,
    PAYBOX_EIP155_CHAIN_ID_PATTERN,
    PAYBOX_INVALID_GRANT_HTTP_STATUS,
    PAYBOX_PROVIDER_ERROR_MESSAGE_FIELDS,
    PAYBOX_PROVIDER_ERROR_MESSAGE_MAX_LENGTH,
    PAYBOX_RATE_LIMIT_HTTP_STATUS,
    PAYBOX_REFRESH_HTTP_STATUS_PATTERN,
    PAYBOX_MANAGEMENT_HOST_BY_API_HOST,
    PAYBOX_SIGNATURE_ARTIFACT_FIELD,
    PAYBOX_SIGNATURE_OUTPUT,
    PAYBOX_TRANSACTION_ARTIFACT_FIELD,
    PAYBOX_SERVER_ERROR_STATUS_MINIMUM,
    PAYBOX_SUCCESS_STATUS,
    PAYBOX_TRANSPORT_ERROR_CODES,
    PAYBOX_TRANSPORT_ERROR_NAMES,
    PAYBOX_WALLET_TYPE,
} from './constants.js';
import {
    PayboxRequestContext,
    PayboxRefreshFailureDisposition,
    PayboxResetCause,
    type EligiblePayboxGrant,
    type EligiblePayboxGrantList,
} from '../types.js';

export function autonomousEvmGrants(value: unknown, baseUrl: string): EligiblePayboxGrantList {
    return {
        grants: grantRows(value).flatMap(normalizeGrant),
        managementUrl: managementUrlFromBaseUrl(baseUrl),
    };
}

export function classifiedPayboxError(error: unknown, context: PayboxRequestContext): Error {
    if (
        error instanceof PayboxAuthFlowError ||
        error instanceof PayboxAuthInvalidError ||
        error instanceof PayboxInvalidOperationArtifactError ||
        error instanceof PayboxOperationDeniedError ||
        error instanceof PayboxOperationIncompleteError ||
        error instanceof PayboxTemporarilyUnavailableError
    ) {
        return error;
    }
    const status = payboxHttpStatus(error, context);
    if (status !== null) return classifiedPayboxHttpStatus(status, context, error);
    if (isNetworkOrTimeoutError(error)) {
        return new PayboxTemporarilyUnavailableError(
            { cause: error },
            context === PayboxRequestContext.Refresh
                ? PayboxRefreshFailureDisposition.Ambiguous
                : PayboxRefreshFailureDisposition.NotApplicable,
        );
    }
    if (context === PayboxRequestContext.Authenticated) return operationIncompleteError(error);
    if (context === PayboxRequestContext.Refresh) {
        return new PayboxTemporarilyUnavailableError(
            error instanceof Error ? { cause: error } : null,
            PayboxRefreshFailureDisposition.Ambiguous,
        );
    }
    return new PayboxAuthFlowError(error instanceof Error ? { cause: error } : null);
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
    if (status === PAYBOX_RATE_LIMIT_HTTP_STATUS || status >= PAYBOX_SERVER_ERROR_STATUS_MINIMUM) {
        return new PayboxTemporarilyUnavailableError(
            options,
            context === PayboxRequestContext.Refresh
                ? PayboxRefreshFailureDisposition.SafeToRetry
                : PayboxRefreshFailureDisposition.NotApplicable,
        );
    }
    if (context === PayboxRequestContext.Authenticated) return operationIncompleteError(cause, status);
    if (context === PayboxRequestContext.Refresh || context === PayboxRequestContext.OAuthToken) {
        return new PayboxAuthInvalidError(
            'Paybox authentication authority was rejected.',
            resetCause(context),
            options,
        );
    }
    return new PayboxAuthFlowError(options);
}

export function signatureFromResponse(value: unknown, credentialId: string): Hex {
    if (isRecord(value) && value.status === PAYBOX_DENIED_STATUS) {
        throw new PayboxOperationDeniedError();
    }
    if (!isRecord(value) || value.status !== PAYBOX_SUCCESS_STATUS || !isRecord(value.output)) {
        throw new PayboxOperationIncompleteError();
    }
    const output = value.output;
    const signature = artifactValue(output.value, PAYBOX_SIGNATURE_ARTIFACT_FIELD);
    if (output.output_type !== PAYBOX_SIGNATURE_OUTPUT || output.credential_id !== credentialId || !isHex(signature)) {
        throw new PayboxInvalidOperationArtifactError(value);
    }
    return signature;
}

export function serializedTransactionFromResponse(value: unknown, credentialId: string): Hex {
    if (isRecord(value) && value.status === PAYBOX_DENIED_STATUS) {
        throw new PayboxOperationDeniedError();
    }
    if (!isRecord(value) || value.status !== PAYBOX_SUCCESS_STATUS || !isRecord(value.output)) {
        throw new PayboxOperationIncompleteError();
    }
    const output = value.output;
    const serializedTransaction = artifactValue(output.value, PAYBOX_TRANSACTION_ARTIFACT_FIELD);
    if (
        output.output_type !== PAYBOX_SIGNATURE_OUTPUT ||
        output.credential_id !== credentialId ||
        !isSerializedTransaction(serializedTransaction)
    ) {
        throw new PayboxInvalidOperationArtifactError(value);
    }
    return serializedTransaction;
}

function artifactValue(value: unknown, field: string): unknown {
    return isRecord(value) ? value[field] : value;
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
        return status === PAYBOX_INVALID_GRANT_HTTP_STATUS || PAYBOX_CONFIRMED_AUTH_HTTP_STATUSES.has(status);
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
    if (PAYBOX_TRANSPORT_ERROR_NAMES.has(error.name)) return true;
    const code = (error as Error & { code: unknown }).code;
    return typeof code === 'string' && PAYBOX_TRANSPORT_ERROR_CODES.has(code);
}

function operationIncompleteError(error: unknown, status: number | null = null): PayboxOperationIncompleteError {
    return new PayboxOperationIncompleteError(
        status,
        providerErrorMessage(error),
        error instanceof Error ? { cause: error } : null,
    );
}

function providerErrorMessage(error: unknown): string | null {
    const message = error instanceof PayboxError ? providerMessageFromBody(error.body) : errorMessage(error);
    if (message === null) return null;
    const normalized = redactString(message).replace(/\s+/gu, ' ').trim();
    if (normalized.length === 0) return null;
    return normalized.slice(0, PAYBOX_PROVIDER_ERROR_MESSAGE_MAX_LENGTH);
}

function providerMessageFromBody(body: string): string | null {
    try {
        const value: unknown = JSON.parse(body);
        if (typeof value === 'string') return value;
        if (!isRecord(value)) return null;
        for (const field of PAYBOX_PROVIDER_ERROR_MESSAGE_FIELDS) {
            const message = value[field];
            if (typeof message === 'string') return message;
        }
        return null;
    } catch {
        return body;
    }
}

function errorMessage(error: unknown): string | null {
    return error instanceof Error ? error.message : null;
}

function grantRows(value: unknown): Array<unknown> {
    if (Array.isArray(value)) return value;
    if (!isRecord(value)) throw new Error('Paybox returned an invalid grant list.');
    if (Array.isArray(value.credentials)) return value.credentials;
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

export function managementUrlFromBaseUrl(baseUrl: string): string | null {
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
    if (isEvmChain(metadata.chain ?? metadata.chain_type ?? metadata.network)) return true;
    const chains = metadata.chains;
    return Array.isArray(chains) && chains.some(isEvmChain);
}

function isEvmChain(chain: unknown): boolean {
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
