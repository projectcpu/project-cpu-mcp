import { getAddress, isAddress, type Hex } from 'viem';

import {
    PAYBOX_AUTONOMOUS_MODE,
    PAYBOX_SIGNATURE_OUTPUT,
    PAYBOX_SUCCESS_STATUS,
    PAYBOX_WALLET_TYPE,
} from './sdk.constants.js';
import type { EligiblePayboxGrant } from './types.js';

export function oneAutonomousEvmGrant(value: unknown): EligiblePayboxGrant {
    const rows = grantRows(value);
    const grants = rows.flatMap(normalizeGrant);
    if (grants.length !== 1) throw new Error('Paybox requires exactly one eligible autonomous EVM wallet grant.');
    return grants[0] as EligiblePayboxGrant;
}

export function signatureFromResponse(value: unknown, credentialId: string): Hex {
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

function grantRows(value: unknown): Array<unknown> {
    if (Array.isArray(value)) return value;
    if (!isRecord(value)) throw new Error('Paybox returned an invalid grant list.');
    if (Array.isArray(value.grants)) return value.grants;
    if (Array.isArray(value.credentials)) return value.credentials;
    throw new Error('Paybox returned an invalid grant list.');
}

function normalizeGrant(value: unknown): Array<EligiblePayboxGrant> {
    if (!isRecord(value)) return [];
    const credential = isRecord(value.credential) ? value.credential : value;
    const grant = isRecord(value.grant) ? value.grant : value;
    if (
        credential.credential_type !== PAYBOX_WALLET_TYPE ||
        credential.disabled_at !== null ||
        grant.approval_mode !== PAYBOX_AUTONOMOUS_MODE ||
        typeof credential.id !== 'string' ||
        credential.id.length === 0
    ) {
        return [];
    }
    const metadata = isRecord(credential.metadata) ? credential.metadata : null;
    const address = metadata === null ? null : addressField(metadata);
    if (metadata === null || address === null || !isEvm(metadata)) return [];
    return [{ credentialId: credential.id, address: getAddress(address) }];
}

function addressField(metadata: Record<string, unknown>): string | null {
    const value = metadata.address ?? metadata.wallet_address;
    return typeof value === 'string' && isAddress(value) ? value : null;
}

function isEvm(metadata: Record<string, unknown>): boolean {
    const chain = metadata.chain ?? metadata.chain_type ?? metadata.network;
    return chain === 'evm' || chain === 'ethereum' || (typeof chain === 'string' && chain.startsWith('eip155:'));
}

function isHex(value: unknown): value is Hex {
    return typeof value === 'string' && /^0x[0-9a-fA-F]{130}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
