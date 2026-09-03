import { describe, expect, it } from 'vitest';

import { WalletMode } from '../../types.js';
import { loadEnvConfig } from '../env.js';
import { Network } from '../types.js';

const PRIVATE_KEY = `0x${'11'.repeat(32)}`;
const EVM_ENV = { WALLET_MODE: WalletMode.EVM, PRIVATE_KEY };

describe('loadEnvConfig WALLET_MODE', () => {
    it('defaults to Paybox without requiring a private key', () => {
        expect(loadEnvConfig({}).WALLET_MODE).toBe(WalletMode.PAYBOX);
    });

    it('retains explicit EVM mode with a private key', () => {
        expect(loadEnvConfig(EVM_ENV).WALLET_MODE).toBe(WalletMode.EVM);
    });

    it('requires a private key in explicit EVM mode', () => {
        expect(() => loadEnvConfig({ WALLET_MODE: WalletMode.EVM })).toThrow(/PRIVATE_KEY/);
    });
});

describe('loadEnvConfig NETWORK', () => {
    it('retains Robinhood-only networking in Paybox mode', () => {
        expect(() => loadEnvConfig({ WALLET_MODE: WalletMode.PAYBOX, NETWORK: Network.BASE })).toThrow(/NETWORK/);
    });
    it('defaults to the Robinhood launch network', () => {
        expect(loadEnvConfig({}).NETWORK).toBe(Network.ARBITRUM);
    });

    it('accepts Robinhood explicitly', () => {
        expect(loadEnvConfig({ ...EVM_ENV, NETWORK: Network.ARBITRUM }).NETWORK).toBe(Network.ARBITRUM);
    });

    it.each([Network.ETHEREUM, Network.ETHEREUM_SEPOLIA, Network.BASE, Network.BASE_SEPOLIA])(
        'rejects unsupported launch network %s',
        (network) => {
            expect(() => loadEnvConfig({ ...EVM_ENV, NETWORK: network })).toThrow(/NETWORK/);
        },
    );
});

describe('loadEnvConfig PRIVATE_KEY', () => {
    it('rejects a malformed private key', () => {
        expect(() => loadEnvConfig({ WALLET_MODE: WalletMode.EVM, PRIVATE_KEY: '0xdeadbeef' })).toThrow(/PRIVATE_KEY/);
    });
});

describe('loadEnvConfig RPC_URL', () => {
    it('is null when the override is absent', () => {
        expect(loadEnvConfig(EVM_ENV).RPC_URL).toBeNull();
    });

    it('keeps an explicit override', () => {
        expect(loadEnvConfig({ ...EVM_ENV, RPC_URL: 'https://rpc.example/robinhood' }).RPC_URL).toBe(
            'https://rpc.example/robinhood',
        );
    });
});

describe('loadEnvConfig OPERATOR_PERSONA', () => {
    it('is on when the variable is absent', () => {
        expect(loadEnvConfig({}).OPERATOR_PERSONA).toBe(true);
    });

    it('is off on an explicit false, whatever the casing', () => {
        expect(loadEnvConfig({ OPERATOR_PERSONA: 'false' }).OPERATOR_PERSONA).toBe(false);
        expect(loadEnvConfig({ OPERATOR_PERSONA: '  FALSE ' }).OPERATOR_PERSONA).toBe(false);
    });

    it('stays on for true and for a value it cannot read', () => {
        expect(loadEnvConfig({ OPERATOR_PERSONA: 'true' }).OPERATOR_PERSONA).toBe(true);
        expect(loadEnvConfig({ OPERATOR_PERSONA: '0' }).OPERATOR_PERSONA).toBe(true);
        expect(loadEnvConfig({ OPERATOR_PERSONA: 'nope' }).OPERATOR_PERSONA).toBe(true);
    });
});
