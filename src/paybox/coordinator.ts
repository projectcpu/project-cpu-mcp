import { PAYBOX_AUTH_REQUIRED_INSTRUCTIONS, PAYBOX_SCHEMA_VERSION } from './constants.js';
import { PayboxLoopbackUnavailableError } from './errors.js';
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
    private address: string | null = null;
    private pendingUrl: string | null = null;
    private starting: Promise<string> | null = null;
    private completing: Promise<void> | null = null;
    private completionError: Error | null = null;
    private authenticating: Promise<string> | null = null;
    private generation = 0;

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
            this.generation += 1;
            this.options.flow.cancel();
            this.options.storage.clear();
            this.wallet = null;
            this.address = null;
            this.pendingUrl = null;
            this.starting = null;
            this.completing = null;
            this.completionError = null;
            this.authenticating = null;
        }
        if (this.completionError !== null) {
            const error = this.completionError;
            this.completionError = null;
            throw error;
        }
        if (this.pendingUrl !== null) {
            if (this.completing === null) {
                const generation = this.generation;
                const completion = this.completePending(generation);
                this.completing = completion;
                void completion.then(
                    () => {
                        if (this.generation === generation && this.completing === completion) {
                            this.completing = null;
                        }
                    },
                    (error: unknown) => {
                        if (this.generation !== generation || this.completing !== completion) return;
                        this.options.flow.cancel();
                        this.pendingUrl = null;
                        this.completing = null;
                        this.completionError =
                            error instanceof Error ? error : new Error('Paybox authentication failed.');
                    },
                );
            }
            return this.authRequired(this.pendingUrl);
        }
        if (this.wallet !== null && this.address !== null) {
            const generation = this.generation;
            await this.authenticateFresh(this.wallet, generation);
            this.assertCurrent(generation);
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
            const wallet = this.options.sdk.createWallet(
                stored.tokens,
                stored.signingKey,
                stored.credentialId,
                stored.address,
            );
            const generation = this.generation;
            await this.authenticateFresh(wallet, generation);
            this.assertCurrent(generation);
            this.wallet = wallet;
            this.address = stored.address;
            return { status: PayboxAuthStatus.Authenticated, address: stored.address };
        }
        if (this.starting === null) {
            const generation = this.generation;
            this.starting = this.options.flow
                .start()
                .then((result) => {
                    this.assertCurrent(generation);
                    return result.authorizationUrl;
                })
                .catch((error: unknown) => {
                    if (error instanceof PayboxLoopbackUnavailableError) {
                        throw new Error('PAYBOX_AUTH_ENVIRONMENT_UNSUPPORTED', { cause: error });
                    }
                    throw error;
                });
        }
        const generation = this.generation;
        const starting = this.starting;
        try {
            const authorizationUrl = await starting;
            this.assertCurrent(generation);
            this.pendingUrl = authorizationUrl;
        } finally {
            if (this.starting === starting) this.starting = null;
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

    private async completePending(generation: number): Promise<void> {
        if (this.pendingUrl === null) throw new Error('No Paybox authentication is pending.');
        const material = await this.options.flow.finish();
        this.assertCurrent(generation);
        const grant = await this.options.sdk.selectOneAutonomousEvmGrant(material.tokens, material.signingKey);
        this.assertCurrent(generation);
        const record = {
            version: PAYBOX_SCHEMA_VERSION,
            tokens: material.tokens,
            signingKey: material.signingKey,
            credentialId: grant.credentialId,
            address: grant.address,
        } as import('./types.js').PayboxAuthRecord;
        const wallet = this.options.sdk.createWallet(
            material.tokens,
            material.signingKey,
            grant.credentialId,
            grant.address,
        );
        await this.authenticateFresh(wallet, generation);
        this.assertCurrent(generation);
        this.options.storage.save(record);
        this.wallet = wallet;
        this.address = grant.address;
        this.pendingUrl = null;
    }

    private async authenticateFresh(wallet: WalletManager, generation: number): Promise<string> {
        if (this.authenticating !== null) return this.authenticating;
        const authentication = this.options.authenticator.authenticate(wallet, () => this.generation === generation);
        this.authenticating = authentication;
        try {
            return await authentication;
        } finally {
            if (this.authenticating === authentication) this.authenticating = null;
        }
    }

    private assertCurrent(generation: number): void {
        if (this.generation !== generation) throw new Error('Paybox authentication was invalidated.');
    }
}
