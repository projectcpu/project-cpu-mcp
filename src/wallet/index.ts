import { WalletMode } from '../types.js';
import { AgwWalletProvider } from './agw.provider.js';
import { EvmWalletProvider } from './evm.provider.js';
import type { CreateWalletProviderInput, WalletProvider } from './types.js';

export type {
    WalletManager,
    WalletProvider,
    TransactionRequest,
    GasEstimateRequest,
    CreateWalletProviderInput,
} from './types.js';

export function createWalletProvider(input: CreateWalletProviderInput): WalletProvider {
    const { config, session, logger } = input;

    if (config.WALLET_MODE === WalletMode.EVM) {
        return new EvmWalletProvider(config, logger.child('wallet:evm'));
    }
    if (config.WALLET_MODE === WalletMode.AGW) {
        return new AgwWalletProvider(config, session, logger.child('wallet:agw'));
    }
    throw new Error('Paybox wallet provider must be created with its explicit authentication dependencies.');
}
