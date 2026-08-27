import { getAddress } from 'viem';

import { PAYBOX_AUTH_REQUIRED_INSTRUCTIONS, PAYBOX_SCHEMA_VERSION } from './constants.js';
import {
    PayboxFullAccessWalletRequiredError,
    PayboxLoopbackUnavailableError,
    PayboxWalletSelectionError,
} from './errors.js';
import {
    PayboxAuthStatus,
    PayboxErrorCode,
    type EligiblePayboxGrant,
    type PayboxAuthMaterial,
    type PayboxAuthenticationFlight,
    type PayboxAuthRecord,
    type PayboxAuthenticateInput,
    type PayboxAuthenticateResult,
    type PayboxCoordinatorOptions,
    PayboxSelectionPhase,
    type PayboxSelectionState,
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
    private authenticating: PayboxAuthenticationFlight | null = null;
    private material: PayboxAuthMaterial | null = null;
    private selection: PayboxSelectionState | null = null;
    private credentialId: string | null = null;
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
        const requestedCredentialId = input.payboxCredentialId ?? null;
        if (input.force) {
            this.generation += 1;
            this.options.flow.cancel();
            this.wallet = null;
            this.address = null;
            this.pendingUrl = null;
            this.starting = null;
            this.completing = null;
            this.completionError = null;
            this.authenticating = null;
            this.material = null;
            this.selection = null;
            this.credentialId = null;
            this.options.storage.clear();
        }
        if (this.completionError !== null) {
            const error = this.completionError;
            this.completionError = null;
            throw error;
        }
        if (this.pendingUrl !== null) {
            if (requestedCredentialId !== null) {
                throw new PayboxWalletSelectionError(PayboxErrorCode.WalletSelectionNotPending);
            }
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
            if (requestedCredentialId !== null) {
                throw new PayboxWalletSelectionError(PayboxErrorCode.WalletSelectionNotPending);
            }
            if (this.credentialId === null) throw new Error('Paybox Wallet identity is incomplete.');
            const generation = this.generation;
            await this.authenticateFresh(this.wallet, generation, this.credentialId, this.address);
            this.assertCurrent(generation);
            return { status: PayboxAuthStatus.Authenticated, address: this.address };
        }
        if (this.material !== null) {
            return this.continueWithMaterial(this.material, requestedCredentialId, this.generation);
        }
        const stored = this.options.storage.load();
        if (
            stored !== null &&
            stored.tokens !== null &&
            stored.signingKey !== null &&
            stored.credentialId !== null &&
            stored.address !== null
        ) {
            if (requestedCredentialId !== null) {
                throw new PayboxWalletSelectionError(PayboxErrorCode.WalletSelectionNotPending);
            }
            const wallet = this.options.sdk.createWallet(
                stored.tokens,
                stored.signingKey,
                stored.credentialId,
                stored.address,
            );
            const generation = this.generation;
            await this.authenticateFresh(wallet, generation, stored.credentialId, stored.address);
            this.assertCurrent(generation);
            this.wallet = wallet;
            this.address = stored.address;
            this.credentialId = stored.credentialId;
            return { status: PayboxAuthStatus.Authenticated, address: stored.address };
        }
        if (stored !== null && stored.tokens !== null && stored.signingKey !== null) {
            this.material = { tokens: stored.tokens, signingKey: stored.signingKey };
            return this.continueWithMaterial(this.material, requestedCredentialId, this.generation);
        }
        if (requestedCredentialId !== null) {
            throw new PayboxWalletSelectionError(PayboxErrorCode.WalletSelectionNotPending);
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
        await this.continueWithMaterial(material, null, generation);
    }

    private async continueWithMaterial(
        material: PayboxAuthMaterial,
        requestedCredentialId: string | null,
        generation: number,
    ): Promise<PayboxAuthenticateResult> {
        if (requestedCredentialId === null && this.selection !== null) {
            return { status: PayboxAuthStatus.WalletSelectionRequired, choices: this.selection.choices };
        }
        if (requestedCredentialId !== null && this.selection === null) {
            throw new PayboxWalletSelectionError(PayboxErrorCode.WalletSelectionNotPending);
        }
        if (requestedCredentialId !== null && this.selection?.phase === PayboxSelectionPhase.Activating) {
            if (this.selection.credentialId === requestedCredentialId) return this.selection.promise;
            throw new PayboxWalletSelectionError(PayboxErrorCode.WalletSelectionNotPending);
        }
        if (requestedCredentialId !== null && this.selection?.phase === PayboxSelectionPhase.AwaitingChoice) {
            const choices = this.selection.choices;
            const activation = this.selectGrant(material, requestedCredentialId, choices, generation);
            this.selection = {
                phase: PayboxSelectionPhase.Activating,
                choices,
                credentialId: requestedCredentialId,
                promise: activation,
            };
            return activation;
        }
        const discovery = await this.options.sdk.listEligibleAutonomousEvmGrants(material.tokens, material.signingKey);
        this.assertCurrent(generation);
        if (discovery.grants.length === 0) {
            this.rememberMaterial(material);
            this.pendingUrl = null;
            throw new PayboxFullAccessWalletRequiredError(discovery.managementUrl);
        }
        if (discovery.grants.length > 1) {
            this.rememberMaterial(material);
            this.selection = { phase: PayboxSelectionPhase.AwaitingChoice, choices: discovery.grants };
            this.pendingUrl = null;
            return { status: PayboxAuthStatus.WalletSelectionRequired, choices: discovery.grants };
        }
        return this.activateGrant(material, discovery.grants[0] as EligiblePayboxGrant, generation);
    }

    private async selectGrant(
        material: PayboxAuthMaterial,
        requestedCredentialId: string,
        previousChoices: Array<EligiblePayboxGrant>,
        generation: number,
    ): Promise<PayboxAuthenticateResult> {
        let discovery;
        try {
            discovery = await this.options.sdk.listEligibleAutonomousEvmGrants(material.tokens, material.signingKey);
            this.assertCurrent(generation);
        } catch (error) {
            this.restoreSelection(requestedCredentialId, previousChoices, generation);
            throw error;
        }
        const selected = discovery.grants.find((grant) => grant.credentialId === requestedCredentialId);
        if (selected === undefined) {
            if (this.isSelectionActivation(requestedCredentialId, generation)) {
                this.selection =
                    discovery.grants.length === 0
                        ? null
                        : { phase: PayboxSelectionPhase.AwaitingChoice, choices: discovery.grants };
            }
            throw new PayboxWalletSelectionError(PayboxErrorCode.WalletSelectionInvalid);
        }
        try {
            return await this.activateGrant(material, selected, generation);
        } catch (error) {
            this.restoreSelection(requestedCredentialId, discovery.grants, generation);
            throw error;
        }
    }

    private async activateGrant(
        material: PayboxAuthMaterial,
        grant: EligiblePayboxGrant,
        generation: number,
    ): Promise<PayboxAuthenticateResult> {
        const address = getAddress(grant.address);
        const record: PayboxAuthRecord = {
            version: PAYBOX_SCHEMA_VERSION,
            tokens: material.tokens,
            signingKey: material.signingKey,
            credentialId: grant.credentialId,
            address,
        };
        const wallet = this.options.sdk.createWallet(material.tokens, material.signingKey, grant.credentialId, address);
        await this.authenticateFresh(wallet, generation, grant.credentialId, address);
        this.assertCurrent(generation);
        this.options.storage.save(record);
        this.wallet = wallet;
        this.address = address;
        this.credentialId = grant.credentialId;
        this.material = null;
        this.selection = null;
        this.pendingUrl = null;
        return { status: PayboxAuthStatus.Authenticated, address };
    }

    private rememberMaterial(material: PayboxAuthMaterial): void {
        const record: PayboxAuthRecord = {
            version: PAYBOX_SCHEMA_VERSION,
            tokens: material.tokens,
            signingKey: material.signingKey,
            credentialId: null,
            address: null,
        };
        this.options.storage.save(record);
        this.material = material;
    }

    private async authenticateFresh(
        wallet: WalletManager,
        generation: number,
        credentialId: string,
        address: string,
    ): Promise<string> {
        if (this.authenticating !== null) {
            if (
                this.authenticating.generation === generation &&
                this.authenticating.credentialId === credentialId &&
                this.authenticating.address === address
            ) {
                return this.authenticating.promise;
            }
            throw new Error('Paybox authentication is already in progress for another Wallet.');
        }
        const authentication = this.options.authenticator.authenticate(wallet, () => this.generation === generation);
        const flight: PayboxAuthenticationFlight = { credentialId, address, generation, promise: authentication };
        this.authenticating = flight;
        try {
            return await authentication;
        } finally {
            if (this.authenticating === flight) this.authenticating = null;
        }
    }

    private restoreSelection(
        requestedCredentialId: string,
        choices: Array<EligiblePayboxGrant>,
        generation: number,
    ): void {
        if (this.isSelectionActivation(requestedCredentialId, generation)) {
            this.selection = { phase: PayboxSelectionPhase.AwaitingChoice, choices };
        }
    }

    private isSelectionActivation(requestedCredentialId: string, generation: number): boolean {
        return (
            this.generation === generation &&
            this.selection?.phase === PayboxSelectionPhase.Activating &&
            this.selection.credentialId === requestedCredentialId
        );
    }

    private assertCurrent(generation: number): void {
        if (this.generation !== generation) throw new Error('Paybox authentication was invalidated.');
    }
}
