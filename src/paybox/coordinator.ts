import { PAYBOX_AUTH_REQUIRED_INSTRUCTIONS, PAYBOX_SCHEMA_VERSION } from './constants.js';
import {
    PayboxAuthStatus,
    PayboxLoopbackUnavailableError,
    type PayboxAuthenticateInput,
    type PayboxAuthenticateResult,
    type PayboxCoordinatorOptions,
} from './types.js';
import type { WalletManager, WalletProvider } from '../wallet/types.js';

/** The sole lifecycle owner: auth transport returns material, this module decides persistence and selection. */
export class PayboxCoordinator implements WalletProvider {
    private readonly options: PayboxCoordinatorOptions;
    private wallet: WalletManager | null = null;
    private address: string | null = null;
    private pendingUrl: string | null = null;
    private starting: Promise<string> | null = null;
    private completing: Promise<void> | null = null;

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
            this.address = null;
            this.pendingUrl = null;
            this.starting = null;
            this.completing = null;
        }
        if (this.wallet !== null && this.address !== null) {
            await this.options.authenticator.authenticate();
            return { status: PayboxAuthStatus.Authenticated, address: this.address };
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
            this.address = stored.address;
            await this.options.authenticator.authenticate();
            return { status: PayboxAuthStatus.Authenticated, address: stored.address };
        }
        if (this.pendingUrl !== null) {
            if (this.completing === null) this.completing = this.completePending();
            if (this.address !== null) return { status: PayboxAuthStatus.Authenticated, address: this.address };
            return this.authRequired(this.pendingUrl);
        }
        if (this.starting === null) {
            this.starting = this.options.flow
                .start()
                .then((result) => result.authorizationUrl)
                .catch((error: unknown) => {
                    if (error instanceof PayboxLoopbackUnavailableError) {
                        throw new Error('PAYBOX_AUTH_ENVIRONMENT_UNSUPPORTED', { cause: error });
                    }
                    throw error;
                });
        }
        try {
            this.pendingUrl = await this.starting;
        } finally {
            this.starting = null;
        }
        return this.authRequired(this.pendingUrl);
    }

    private authRequired(authorizationUrl: string): PayboxAuthenticateResult {
        return {
            status: PayboxAuthStatus.AuthRequired,
            instructions: PAYBOX_AUTH_REQUIRED_INSTRUCTIONS,
            authorizationUrl,
        };
    }

    private async completePending(): Promise<void> {
        if (this.pendingUrl === null) throw new Error('No Paybox authentication is pending.');
        const material = await this.options.flow.finish();
        const grant = await this.options.sdk.selectOneAutonomousEvmGrant(material.tokens, material.signingKey);
        this.options.storage.save({
            version: PAYBOX_SCHEMA_VERSION,
            tokens: material.tokens,
            signingKey: material.signingKey,
            credentialId: grant.credentialId,
            address: grant.address,
        } as import('./types.js').PayboxAuthRecord);
        this.wallet = this.options.sdk.createWallet(
            material.tokens,
            material.signingKey,
            grant.credentialId,
            grant.address,
        );
        this.address = grant.address;
        this.pendingUrl = null;
        await this.options.authenticator.authenticate();
    }
}
