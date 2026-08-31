import { getAddress, recoverMessageAddress, type Address, type Hex } from 'viem';

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
