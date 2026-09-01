import { recoverTypedDataAddress, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it } from 'vitest';

import { LAUNCH_CHAIN_ID } from '../../config/constants.js';
import {
    SEAPORT_ADDRESS,
    SEAPORT_DOMAIN_NAME,
    SEAPORT_DOMAIN_VERSION,
    SEAPORT_ORDER_COMPONENTS_TYPES,
    SEAPORT_ORDER_PRIMARY_TYPE,
} from '../../contracts/seaport.constants.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { EvmWalletManager } from '../evm.manager.js';
import type { SignTypedDataRequest } from '../types.js';

const PRIVATE_KEY = `0x${'11'.repeat(32)}` as Hex;

const ORDER = {
    offerer: '0x1111111111111111111111111111111111111111',
    zone: '0x0000000000000000000000000000000000000000',
    offer: [
        {
            itemType: 2,
            token: '0x2222222222222222222222222222222222222222',
            identifierOrCriteria: '1234',
            startAmount: '1',
            endAmount: '1',
        },
    ],
    consideration: [
        {
            itemType: 1,
            token: '0x3333333333333333333333333333333333333333',
            identifierOrCriteria: '0',
            startAmount: '975000000000000000',
            endAmount: '975000000000000000',
            recipient: '0x1111111111111111111111111111111111111111',
        },
        {
            itemType: 1,
            token: '0x3333333333333333333333333333333333333333',
            identifierOrCriteria: '0',
            startAmount: '25000000000000000',
            endAmount: '25000000000000000',
            recipient: '0x4444444444444444444444444444444444444444',
        },
    ],
    orderType: 0,
    startTime: '1800000000',
    endTime: '1800086400',
    zoneHash: `0x${'0'.repeat(64)}`,
    salt: '987654321',
    conduitKey: `0x${'0'.repeat(64)}`,
    counter: '0',
};

const DOMAIN = {
    name: SEAPORT_DOMAIN_NAME,
    version: SEAPORT_DOMAIN_VERSION,
    chainId: LAUNCH_CHAIN_ID,
    verifyingContract: SEAPORT_ADDRESS,
} as const;

function walletOver(): EvmWalletManager {
    return new EvmWalletManager({
        privateKey: PRIVATE_KEY,
        chainId: LAUNCH_CHAIN_ID,
        rpcUrl: null,
        logger: new NoopLogger(),
    });
}

function signingRequest(message: Record<string, unknown>): SignTypedDataRequest {
    return {
        domain: { ...DOMAIN },
        types: SEAPORT_ORDER_COMPONENTS_TYPES,
        primaryType: SEAPORT_ORDER_PRIMARY_TYPE,
        message,
    };
}

function recoverSigner(signature: Hex, verifyingContract: string): Promise<string> {
    return recoverTypedDataAddress({
        domain: { ...DOMAIN, verifyingContract },
        types: SEAPORT_ORDER_COMPONENTS_TYPES,
        primaryType: SEAPORT_ORDER_PRIMARY_TYPE,
        message: ORDER,
        signature,
    } as unknown as Parameters<typeof recoverTypedDataAddress>[0]);
}

describe('the EVM wallet signing a Seaport order', () => {
    it('produces a signature that recovers the active wallet under the launch-chain protocol domain', async () => {
        const wallet = walletOver();

        const signature = await wallet.signTypedData(signingRequest(ORDER));

        await expect(recoverSigner(signature, SEAPORT_ADDRESS)).resolves.toBe(wallet.getAddress());
        expect(wallet.getAddress()).toBe(privateKeyToAccount(PRIVATE_KEY).address);
    });

    it('excludes totalOriginalConsiderationItems from the signed message', async () => {
        const wallet = walletOver();

        const signed = await wallet.signTypedData(signingRequest(ORDER));
        const withTransportMetadata = await wallet.signTypedData(
            signingRequest({ ...ORDER, totalOriginalConsiderationItems: 2 }),
        );

        expect(withTransportMetadata).toBe(signed);
    });

    it('binds the signature to the pinned protocol address, so another verifying contract cannot reuse it', async () => {
        const wallet = walletOver();

        const signature = await wallet.signTypedData(signingRequest(ORDER));

        await expect(recoverSigner(signature, '0x5555555555555555555555555555555555555555')).resolves.not.toBe(
            wallet.getAddress(),
        );
    });
});
