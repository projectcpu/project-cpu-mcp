import type { Address } from 'viem';
import { createSiweMessage } from 'viem/siwe';

export interface BuildSiweMessageInput {
    address: Address;
    chainId: number;
    apiUrl: string;
    nonce: string;
    issuedAt: string;
    expirationTime: string;
}

const SIWE_STATEMENT = 'Sign in to Project CPU.';

/**
 * Builds an EIP-4361 SIWE message from the server-issued nonce. `domain`/`uri` are derived
 * from the API URL — the server pins neither, but viem still validates `expirationTime`,
 * so the nonce TTL window is passed through.
 */
export function buildSiweMessage(input: BuildSiweMessageInput): string {
    const url = new URL(input.apiUrl);
    return createSiweMessage({
        domain: url.host,
        address: input.address,
        statement: SIWE_STATEMENT,
        uri: url.origin,
        version: '1',
        chainId: input.chainId,
        nonce: input.nonce,
        issuedAt: new Date(input.issuedAt),
        expirationTime: new Date(input.expirationTime),
    });
}
