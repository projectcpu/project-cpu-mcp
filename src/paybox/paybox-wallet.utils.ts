import {
    getAddress,
    parseTransaction,
    recoverMessageAddress,
    recoverTransactionAddress,
    type Address,
    type Hex,
    type TransactionSerialized,
} from 'viem';

import type { PayboxTransactionIntent } from './types.js';

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
        throw new Error('Paybox returned a malformed signed transaction.');
    }
    if (transaction.type !== 'eip1559') {
        throw new Error('Paybox signed transaction must be EIP-1559.');
    }
    if (getAddress(signer) !== getAddress(address)) {
        throw new Error('Paybox signed transaction signer does not match the selected wallet.');
    }
    if (transaction.to == null || getAddress(transaction.to) !== getAddress(intent.to)) {
        throw new Error('Paybox signed transaction destination does not match the requested intent.');
    }
    assertHexField('calldata', transaction.data ?? '0x', intent.data);
    assertField('value', transaction.value ?? 0n, intent.value);
    assertField('chain ID', transaction.chainId, intent.chainId);
    assertField('gas', transaction.gas, intent.gas);
    assertField('maximum priority fee', transaction.maxPriorityFeePerGas, intent.maxPriorityFeePerGas);
    assertField('maximum fee', transaction.maxFeePerGas, intent.maxFeePerGas);
    assertField('nonce', transaction.nonce, intent.nonce);
    if ((transaction.accessList ?? []).length !== 0) {
        throw new Error('Paybox signed transaction contains an unexpected access list.');
    }
    return serializedTransaction;
}

function assertField(label: string, actual: bigint | number | undefined, expected: bigint | number): void {
    if (actual !== expected) {
        throw new Error(`Paybox signed transaction ${label} does not match the requested intent.`);
    }
}

function assertHexField(label: string, actual: Hex | undefined, expected: Hex): void {
    if (actual?.toLowerCase() !== expected.toLowerCase()) {
        throw new Error(`Paybox signed transaction ${label} does not match the requested intent.`);
    }
}
