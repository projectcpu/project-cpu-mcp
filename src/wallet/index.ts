import { WalletMode } from '../types.js';
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
    const { config, logger } = input;

    if (config.WALLET_MODE === WalletMode.EVM) {
        return new EvmWalletProvider(config, logger.child('wallet:evm'));
    }
    throw new Error('Paybox wallet provider must be created with its explicit authentication dependencies.');
}
