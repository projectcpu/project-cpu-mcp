import {
    getAddress,
    parseTransaction,
    recoverMessageAddress,
    recoverTransactionAddress,
    type Address,
    type Hex,
    type TransactionSerialized,
} from 'viem';

import { PayboxAuthInvalidError, PayboxInvalidOperationArtifactError } from './errors.js';
import { PayboxResetCause, type PayboxTransactionIntent } from './types.js';

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

export async function verifiedPayboxTransaction(
    intent: PayboxTransactionIntent,
    serializedTransaction: Hex,
    address: Address,
): Promise<Hex> {
    let transaction;
    let signer: Address;
    try {
        transaction = parseTransaction(serializedTransaction as TransactionSerialized);
        signer = await recoverTransactionAddress({
            serializedTransaction: serializedTransaction as TransactionSerialized,
        });
    } catch {
        throw new PayboxInvalidOperationArtifactError();
    }
    if (transaction.type !== 'eip1559') {
        throw new PayboxInvalidOperationArtifactError();
    }
    if (getAddress(signer) !== getAddress(address)) {
        throw new PayboxAuthInvalidError(
            'Paybox signed transaction signer does not match the selected wallet.',
            PayboxResetCause.InvalidSigningAuthority,
        );
    }
    if (transaction.to == null || getAddress(transaction.to) !== getAddress(intent.to)) {
        throw new PayboxInvalidOperationArtifactError();
    }
    assertHexField('calldata', transaction.data ?? '0x', intent.data);
    assertField('value', transaction.value ?? 0n, intent.value);
    assertField('chain ID', transaction.chainId, intent.chainId);
    assertField('gas', transaction.gas, intent.gas);
    assertField('maximum priority fee', transaction.maxPriorityFeePerGas, intent.maxPriorityFeePerGas);
    assertField('maximum fee', transaction.maxFeePerGas, intent.maxFeePerGas);
    assertField('nonce', transaction.nonce, intent.nonce);
    if ((transaction.accessList ?? []).length !== 0) {
        throw new PayboxInvalidOperationArtifactError();
    }
    return serializedTransaction;
}

function assertField(_label: string, actual: bigint | number | undefined, expected: bigint | number): void {
    if (actual !== expected) {
        throw new PayboxInvalidOperationArtifactError();
    }
}

function assertHexField(_label: string, actual: Hex | undefined, expected: Hex): void {
    if (actual?.toLowerCase() !== expected.toLowerCase()) {
        throw new PayboxInvalidOperationArtifactError();
    }
}
