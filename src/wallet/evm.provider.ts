import type { Hex } from 'viem';

import { EvmWalletManager } from './evm.manager.js';
import type { WalletManager, WalletProvider } from './types.js';
import { chainIdForNetwork } from '../config/network.utils.js';
import type { EnvConfig } from '../config/types.js';
import type { ILogger } from '../logger/types.js';

export class EvmWalletProvider implements WalletProvider {
    private readonly wallet: WalletManager;

    constructor(config: EnvConfig, logger: ILogger) {
        if (config.PRIVATE_KEY === null) {
            throw new Error('EVM mode requires PRIVATE_KEY in env');
        }
        this.wallet = new EvmWalletManager({
            privateKey: config.PRIVATE_KEY as Hex,
            chainId: chainIdForNetwork(config.NETWORK),
            rpcUrl: config.RPC_URL,
            logger,
        });
    }

    get(): WalletManager {
        return this.wallet;
    }

    isReady(): boolean {
        return true;
    }
}
