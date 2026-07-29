import type { Hex } from 'viem';

import { AgwWalletManager } from './agw.manager.js';
import type { WalletManager, WalletProvider } from './types.js';
import type { EnvConfig } from '../config/types.js';
import type { ILogger } from '../logger/types.js';
import type { SessionManager } from '../session/manager.js';
import { SessionStatus } from '../session/types.js';

export class AgwWalletProvider implements WalletProvider {
    private cached: { wallet: WalletManager; sessionHash: string } | null = null;

    constructor(
        private readonly config: EnvConfig,
        private readonly session: SessionManager,
        private readonly logger: ILogger,
    ) {}

    get(): WalletManager {
        if (this.session.getStatus() === SessionStatus.Missing) {
            throw new Error('AGW wallet not ready. Call the `authenticate` tool first.');
        }

        const data = this.session.getSession();
        if (data.sessionConfig === null || data.sessionPrivateKey === null) {
            throw new Error('AGW session is incomplete. Call the `authenticate` tool first.');
        }

        if (data.sessionConfig.expiresAt * 1000 < Date.now()) {
            this.cached = null;
            this.session.clear();
            throw new Error('AGW session expired. Call the `authenticate` tool to renew.');
        }

        if (this.cached?.sessionHash === data.sessionConfig.sessionHash) {
            return this.cached.wallet;
        }

        const wallet = new AgwWalletManager({
            sessionPrivateKey: data.sessionPrivateKey as Hex,
            sessionConfig: data.sessionConfig,
            rpcUrl: this.config.RPC_URL,
            logger: this.logger,
        });
        this.cached = { wallet, sessionHash: data.sessionConfig.sessionHash };
        return wallet;
    }

    isReady(): boolean {
        try {
            this.get();
            return true;
        } catch {
            return false;
        }
    }
}
