import { getAddress, recoverMessageAddress, recoverTypedDataAddress, type Address, type Hex } from 'viem';

import type { SignTypedDataRequest } from '../../wallet/types.js';
import { PayboxAuthInvalidError } from '../errors.js';
import { PayboxResetCause } from '../types.js';

export async function verifiedPayboxMessageSignature(message: string, signature: Hex, address: Address): Promise<Hex> {
    let signer: Address;
    try {
        signer = await recoverMessageAddress({ message, signature });
    } catch (error) {
        throw new PayboxAuthInvalidError(
            'Paybox returned a malformed message signature.',
            PayboxResetCause.InvalidSigningAuthority,
            {
                cause: error,
            },
        );
    }
    if (getAddress(signer) !== getAddress(address)) {
        throw new PayboxAuthInvalidError(
            'Paybox signature does not match the selected wallet.',
            PayboxResetCause.InvalidSigningAuthority,
        );
    }
    return signature;
}

export async function verifiedPayboxTypedDataSignature(
    request: SignTypedDataRequest,
    signature: Hex,
    address: Address,
): Promise<Hex> {
    let signer: Address;
    try {
        signer = await recoverTypedDataAddress({
            ...request,
            signature,
        } as unknown as Parameters<typeof recoverTypedDataAddress>[0]);
    } catch (error) {
        throw new PayboxAuthInvalidError(
            'Paybox returned a malformed typed-data signature.',
            PayboxResetCause.InvalidSigningAuthority,
            { cause: error },
        );
    }
    if (getAddress(signer) !== getAddress(address)) {
        throw new PayboxAuthInvalidError(
            'Paybox typed-data signature does not match the selected wallet.',
            PayboxResetCause.InvalidSigningAuthority,
        );
    }
    return signature;
}
