import { describe, expect, it } from 'vitest';

import { WalletMode } from '../../types.js';
import { loadEnvConfig } from '../env.js';
import { Network } from '../types.js';

const PRIVATE_KEY = `0x${'11'.repeat(32)}`;

describe('loadEnvConfig NETWORK', () => {
    it('accepts Paybox without a private key while retaining Robinhood-only networking', () => {
        expect(loadEnvConfig({ WALLET_MODE: WalletMode.PAYBOX }).WALLET_MODE).toBe(WalletMode.PAYBOX);
        expect(() => loadEnvConfig({ WALLET_MODE: WalletMode.PAYBOX, NETWORK: Network.BASE })).toThrow(/NETWORK/);
    });
    it('defaults to the Robinhood launch network', () => {
        expect(loadEnvConfig({ PRIVATE_KEY }).NETWORK).toBe(Network.ROBINHOOD);
    });

    it('accepts Robinhood explicitly', () => {
        expect(loadEnvConfig({ PRIVATE_KEY, NETWORK: Network.ROBINHOOD }).NETWORK).toBe(Network.ROBINHOOD);
    });

    it.each([Network.ETHEREUM, Network.ETHEREUM_SEPOLIA, Network.BASE, Network.BASE_SEPOLIA])(
        'rejects unsupported launch network %s',
        (network) => {
            expect(() => loadEnvConfig({ PRIVATE_KEY, NETWORK: network })).toThrow(/NETWORK/);
        },
    );
});

describe('loadEnvConfig OPERATOR_PERSONA', () => {
    it('is on when the variable is absent', () => {
        expect(loadEnvConfig({ PRIVATE_KEY }).OPERATOR_PERSONA).toBe(true);
    });

    it('is off on an explicit false, whatever the casing', () => {
        expect(loadEnvConfig({ PRIVATE_KEY, OPERATOR_PERSONA: 'false' }).OPERATOR_PERSONA).toBe(false);
        expect(loadEnvConfig({ PRIVATE_KEY, OPERATOR_PERSONA: '  FALSE ' }).OPERATOR_PERSONA).toBe(false);
    });

    it('stays on for true and for a value it cannot read', () => {
        expect(loadEnvConfig({ PRIVATE_KEY, OPERATOR_PERSONA: 'true' }).OPERATOR_PERSONA).toBe(true);
        expect(loadEnvConfig({ PRIVATE_KEY, OPERATOR_PERSONA: '0' }).OPERATOR_PERSONA).toBe(true);
        expect(loadEnvConfig({ PRIVATE_KEY, OPERATOR_PERSONA: 'nope' }).OPERATOR_PERSONA).toBe(true);
    });
});
