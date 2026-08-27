import { PAYBOX_AUTH_REQUIRED_INSTRUCTIONS, PAYBOX_SCHEMA_VERSION } from './constants.js';
import {
    PayboxAuthStatus,
    type PayboxAuthenticateInput,
    type PayboxAuthenticateResult,
    type PayboxCoordinatorOptions,
} from './types.js';
import type { WalletManager, WalletProvider } from '../wallet/types.js';

/** The sole lifecycle owner: auth transport returns material, this module decides persistence and selection. */
export class PayboxCoordinator implements WalletProvider {
    private readonly options: PayboxCoordinatorOptions;
    private wallet: WalletManager | null = null;
    private pendingUrl: string | null = null;

    constructor(options: PayboxCoordinatorOptions) {
        this.options = options;
    }

    isReady(): boolean {
        return this.wallet !== null;
    }

    get(): WalletManager {
        if (this.wallet === null) throw new Error('Paybox wallet is not authenticated. Call cpu_authenticate first.');
        return this.wallet;
    }

    async authenticate(input: PayboxAuthenticateInput): Promise<PayboxAuthenticateResult> {
        if (input.force) {
            this.options.flow.cancel();
            this.options.storage.clear();
            this.wallet = null;
            this.pendingUrl = null;
        }
        const stored = this.options.storage.load();
        if (
            stored !== null &&
            stored.tokens !== null &&
            stored.signingKey !== null &&
            stored.credentialId !== null &&
            stored.address !== null
        ) {
            this.wallet = this.options.sdk.createWallet(
                stored.tokens,
                stored.signingKey,
                stored.credentialId,
                stored.address,
            );
            return { status: PayboxAuthStatus.Authenticated, address: stored.address };
        }
        if (this.pendingUrl === null) {
            this.pendingUrl = (await this.options.flow.start()).authorizationUrl;
        }
        return {
            status: PayboxAuthStatus.AuthRequired,
            instructions: PAYBOX_AUTH_REQUIRED_INSTRUCTIONS,
            authorizationUrl: this.pendingUrl,
        };
    }

    async completePending(): Promise<PayboxAuthenticateResult> {
        if (this.pendingUrl === null) throw new Error('No Paybox authentication is pending.');
        const material = await this.options.flow.finish();
        const grant = await this.options.sdk.selectOneAutonomousEvmGrant(material.tokens, material.signingKey);
        this.options.storage.save({
            version: PAYBOX_SCHEMA_VERSION,
            tokens: material.tokens,
            signingKey: material.signingKey,
            credentialId: grant.credentialId,
            address: grant.address,
        });
        this.wallet = this.options.sdk.createWallet(
            material.tokens,
            material.signingKey,
            grant.credentialId,
            grant.address,
        );
        this.pendingUrl = null;
        return { status: PayboxAuthStatus.Authenticated, address: grant.address };
    }
}
