import { getAddress, recoverMessageAddress, type Address, type Hex } from 'viem';

export async function verifiedPayboxMessageSignature(message: string, signature: Hex, address: Address): Promise<Hex> {
    let signer: Address;
    try {
        signer = await recoverMessageAddress({ message, signature });
    } catch {
        throw new Error('Paybox returned a malformed message signature.');
    }
    if (getAddress(signer) !== getAddress(address)) {
        throw new Error('Paybox signature does not match the selected wallet.');
    }
    return signature;
}
