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

    return new EvmWalletProvider(config, logger.child('wallet:evm'));
}
