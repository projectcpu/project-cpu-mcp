import { getAddress, type Address } from 'viem';

import {
    PAYBOX_AUTH_REQUIRED_INSTRUCTIONS,
    PAYBOX_SCHEMA_VERSION,
    PAYBOX_TOKEN_REFRESH_WINDOW_MS,
} from '../constants.js';
import { payboxRefreshState, withPayboxRefreshState } from './coordinator.utils.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type { ILogger } from '../../logger/types.js';
import type { WalletManager, WalletProvider } from '../../wallet/types.js';
import {
    PayboxAuthFlowError,
    PayboxAuthInvalidError,
    PayboxFullAccessWalletRequiredError,
    PayboxLoopbackUnavailableError,
    PayboxTemporarilyUnavailableError,
    PayboxWalletSelectionError,
} from '../errors.js';
import {
    PayboxAuthStatus,
    PayboxErrorCode,
    PayboxResetCause,
    PayboxRefreshFailureDisposition,
    PayboxRefreshState,
    type EligiblePayboxGrant,
    type PayboxAuthMaterial,
    type PayboxAuthenticationFlight,
    type PayboxAuthRecord,
    type PayboxAuthenticateInput,
    type PayboxAuthenticateResult,
    type PayboxContinuationFlight,
    type PayboxCoordinatorOptions,
    type PayboxRefreshFlight,
    type PayboxRestoredAuthenticationFlight,
    PayboxSelectionPhase,
    type PayboxSelectionState,
    type PayboxWalletAuthority,
} from '../types.js';

/** The sole lifecycle owner: auth transport returns material, this module decides persistence and selection. */
export class PayboxCoordinator implements WalletProvider {
    private readonly options: PayboxCoordinatorOptions;
    private wallet: WalletManager | null = null;
    private walletGeneration: number | null = null;
    private address: Address | null = null;
    private pendingUrl: string | null = null;
    private starting: Promise<string> | null = null;
    private forcing: Promise<PayboxAuthenticateResult> | null = null;
    private completing: Promise<void> | null = null;
    private completionError: Error | null = null;
    private authenticating: PayboxAuthenticationFlight | null = null;
    private restoring: PayboxRestoredAuthenticationFlight | null = null;
    private continuing: PayboxContinuationFlight | null = null;
    private material: PayboxAuthMaterial | null = null;
    private selection: PayboxSelectionState | null = null;
    private credentialId: string | null = null;
    private refreshing: PayboxRefreshFlight | null = null;
    private refreshPersistenceError: Error | null = null;
    private generation = 0;

    constructor(
        options: PayboxCoordinatorOptions,
        private readonly logger: ILogger = new NoopLogger(),
    ) {
        this.options = options;
        const stored = options.storage.load();
        if (stored?.tokens === null || stored?.signingKey === null || stored === null) return;
        if (payboxRefreshState(stored) === PayboxRefreshState.ExchangePending) {
            this.refreshPersistenceError = new PayboxTemporarilyUnavailableError(
                null,
                PayboxRefreshFailureDisposition.Ambiguous,
            );
        }
        this.material = { tokens: stored.tokens, signingKey: stored.signingKey };
        if (stored.credentialId === null || stored.address === null) return;
        this.credentialId = stored.credentialId;
        this.address = stored.address;
        this.wallet = options.sdk.createWallet(
            stored.tokens,
            stored.signingKey,
            stored.credentialId,
            stored.address,
            this.walletAuthority(this.material, stored.credentialId, stored.address, this.generation),
        );
        this.walletGeneration = this.generation;
    }

    isReady(): boolean {
        return this.wallet !== null && this.walletGeneration === this.generation;
    }

    get(): WalletManager {
        if (!this.isReady() || this.wallet === null) {
            throw new Error('Paybox wallet is not authenticated. Call cpu_authenticate first.');
        }
        return this.wallet;
    }

    authenticate(input: PayboxAuthenticateInput): Promise<PayboxAuthenticateResult> {
        const requestedCredentialId = input.payboxCredentialId ?? null;
        if (!input.force) return this.authenticateWithRecovery(requestedCredentialId);
        if (this.forcing !== null) return this.forcing;
        this.forcing = this.runForcedAuthentication();
        return this.forcing;
    }

    private async runForcedAuthentication(): Promise<PayboxAuthenticateResult> {
        try {
            return await this.authenticateForced();
        } finally {
            this.forcing = null;
        }
    }

    private async authenticateForced(): Promise<PayboxAuthenticateResult> {
        this.resetAuthState();
        return this.authenticateWithRecovery(null);
    }

    private async authenticateWithRecovery(requestedCredentialId: string | null): Promise<PayboxAuthenticateResult> {
        try {
            return await this.authenticateCurrent(requestedCredentialId);
        } catch (error) {
            if (error instanceof PayboxAuthInvalidError) {
                this.logger.warn('Paybox authentication authority invalidated', { ...error.diagnostic });
                this.resetAuthState();
                return this.authenticateCurrent(null);
            }
            if (error instanceof PayboxAuthFlowError || error instanceof PayboxTemporarilyUnavailableError) {
                this.logger.warn('Paybox authentication request failed', { ...error.diagnostic });
            }
            throw error;
        }
    }

    private async authenticateCurrent(requestedCredentialId: string | null): Promise<PayboxAuthenticateResult> {
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
        if (this.isReady() && this.wallet !== null && this.address !== null) {
            if (requestedCredentialId !== null) {
                throw new PayboxWalletSelectionError(PayboxErrorCode.WalletSelectionNotPending);
            }
            if (this.credentialId === null) throw new Error('Paybox Wallet identity is incomplete.');
            const generation = await this.refreshIfExpiring();
            if (!this.isReady() || this.wallet === null || this.material === null) {
                throw new Error('Paybox Wallet restoration failed.');
            }
            return this.authenticateRestored(this.wallet, this.material, generation, this.credentialId, this.address);
        }
        if (this.material !== null) {
            const generation = await this.refreshIfExpiring();
            if (this.material === null) throw new Error('Paybox auth material is unavailable.');
            return this.continueAuthentication(this.material, requestedCredentialId, generation);
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

    private resetAuthState(): void {
        this.generation += 1;
        this.wallet = null;
        this.walletGeneration = null;
        this.address = null;
        this.pendingUrl = null;
        this.starting = null;
        this.completing = null;
        this.completionError = null;
        this.authenticating = null;
        this.restoring = null;
        this.continuing = null;
        this.material = null;
        this.selection = null;
        this.credentialId = null;
        this.refreshing = null;
        this.refreshPersistenceError = null;
        let resetError: Error | null = null;
        for (const clear of [
            () => this.options.flow.cancel(),
            () => this.options.storage.clear(),
            () => this.options.authenticator.clearSession(),
        ]) {
            try {
                clear();
            } catch (error) {
                resetError ??= error instanceof Error ? error : new Error('Paybox authentication reset failed.');
            }
        }
        if (resetError !== null) throw resetError;
    }

    private authenticateRestored(
        wallet: WalletManager,
        material: PayboxAuthMaterial,
        generation: number,
        credentialId: string,
        address: Address,
    ): Promise<PayboxAuthenticateResult> {
        if (this.restoring !== null) {
            if (
                this.restoring.generation === generation &&
                this.restoring.credentialId === credentialId &&
                this.restoring.address === address
            ) {
                return this.restoring.promise;
            }
            throw new Error('Paybox authentication is already in progress for another Wallet.');
        }
        const authentication = this.runRestoredAuthentication(wallet, material, generation, credentialId, address);
        const flight: PayboxRestoredAuthenticationFlight = {
            credentialId,
            address,
            generation,
            promise: authentication,
        };
        this.restoring = flight;
        return authentication;
    }

    private async runRestoredAuthentication(
        wallet: WalletManager,
        material: PayboxAuthMaterial,
        generation: number,
        credentialId: string,
        address: Address,
    ): Promise<PayboxAuthenticateResult> {
        try {
            return await this.validateRestored(wallet, material, generation, credentialId, address);
        } finally {
            if (
                this.restoring?.generation === generation &&
                this.restoring.credentialId === credentialId &&
                this.restoring.address === address
            ) {
                this.restoring = null;
            }
        }
    }

    private async validateRestored(
        wallet: WalletManager,
        material: PayboxAuthMaterial,
        generation: number,
        credentialId: string,
        address: Address,
    ): Promise<PayboxAuthenticateResult> {
        const discovery = await this.options.sdk.listEligibleAutonomousEvmGrants(material.tokens, material.signingKey);
        this.assertCurrent(generation);
        const selected = discovery.grants.find((grant) => grant.credentialId === credentialId);
        if (selected === undefined || getAddress(selected.address) !== address) {
            throw new PayboxAuthInvalidError(
                'The selected Paybox Wallet grant is no longer valid.',
                PayboxResetCause.SelectedGrantMissing,
            );
        }
        await this.authenticateFresh(wallet, generation, credentialId, address);
        this.assertCurrent(generation);
        return { status: PayboxAuthStatus.Authenticated, address };
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
        await this.continueAuthentication(material, null, generation);
    }

    private continueAuthentication(
        material: PayboxAuthMaterial,
        requestedCredentialId: string | null,
        generation: number,
    ): Promise<PayboxAuthenticateResult> {
        if (this.continuing !== null) {
            if (this.continuing.generation !== generation || this.continuing.material !== material) {
                throw new Error('Paybox authentication is already in progress for another auth state.');
            }
            if (
                this.continuing.requestedCredentialId === requestedCredentialId ||
                (requestedCredentialId === null && this.continuing.requestedCredentialId !== null)
            ) {
                return this.continuing.promise;
            }
            throw new PayboxWalletSelectionError(PayboxErrorCode.WalletSelectionNotPending);
        }
        const continuation = this.runContinuation(material, requestedCredentialId, generation);
        const flight: PayboxContinuationFlight = {
            material,
            requestedCredentialId,
            generation,
            promise: continuation,
        };
        this.continuing = flight;
        return continuation;
    }

    private async runContinuation(
        material: PayboxAuthMaterial,
        requestedCredentialId: string | null,
        generation: number,
    ): Promise<PayboxAuthenticateResult> {
        try {
            return await this.continueWithMaterial(material, requestedCredentialId, generation);
        } finally {
            if (
                this.continuing?.generation === generation &&
                this.continuing.material === material &&
                this.continuing.requestedCredentialId === requestedCredentialId
            ) {
                this.continuing = null;
            }
        }
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
        const wallet = this.options.sdk.createWallet(
            material.tokens,
            material.signingKey,
            grant.credentialId,
            address,
            this.walletAuthority(material, grant.credentialId, address, generation),
        );
        await this.authenticateFresh(wallet, generation, grant.credentialId, address);
        this.assertCurrent(generation);
        this.options.storage.save(record);
        this.wallet = wallet;
        this.walletGeneration = generation;
        this.address = address;
        this.credentialId = grant.credentialId;
        this.material = material;
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

    private async refreshIfExpiring(): Promise<number> {
        if (this.refreshPersistenceError !== null) throw this.refreshPersistenceError;
        const material = this.material;
        if (material === null) return this.generation;
        if (
            material.tokens.expiresAt === null ||
            material.tokens.expiresAt > Date.now() + PAYBOX_TOKEN_REFRESH_WINDOW_MS
        ) {
            return this.generation;
        }
        if (this.refreshing !== null) {
            await this.refreshing.promise;
            return this.generation;
        }
        const generation = this.generation;
        const refresh = this.rotateTokens(material, generation);
        const flight: PayboxRefreshFlight = { generation, promise: refresh };
        this.refreshing = flight;
        try {
            await refresh;
        } finally {
            if (this.refreshing === flight) this.refreshing = null;
        }
        return this.generation;
    }

    private async rotateTokens(material: PayboxAuthMaterial, generation: number): Promise<void> {
        if (material.tokens.refreshToken === null) {
            throw new PayboxAuthInvalidError(
                'Paybox OAuth refresh token is unavailable.',
                PayboxResetCause.InvalidRefresh,
            );
        }
        const currentRecord: PayboxAuthRecord = {
            version: PAYBOX_SCHEMA_VERSION,
            tokens: material.tokens,
            signingKey: material.signingKey,
            credentialId: this.credentialId,
            address: this.address,
        };
        // A crash after the exchange may lose rotated credentials, so restart must not reuse the previous token blindly.
        this.options.storage.save(withPayboxRefreshState(currentRecord, PayboxRefreshState.ExchangePending));
        let tokens: PayboxAuthMaterial['tokens'];
        try {
            tokens = await this.options.sdk.refreshTokens(material.tokens);
        } catch (error) {
            const refreshError =
                error instanceof Error ? error : new Error('Paybox OAuth tokens could not be refreshed safely.');
            if (this.generation === generation) {
                if (refreshError instanceof PayboxTemporarilyUnavailableError) {
                    try {
                        this.options.storage.save(withPayboxRefreshState(currentRecord, PayboxRefreshState.Ready));
                        this.refreshPersistenceError = null;
                    } catch (persistenceError) {
                        this.refreshPersistenceError =
                            persistenceError instanceof Error
                                ? persistenceError
                                : new Error('Paybox refresh recovery could not be persisted.');
                        throw this.refreshPersistenceError;
                    }
                } else {
                    this.refreshPersistenceError = refreshError;
                }
            }
            throw refreshError;
        }
        this.assertCurrent(generation);
        const refreshed: PayboxAuthMaterial = { tokens, signingKey: material.signingKey };
        const record: PayboxAuthRecord = {
            version: PAYBOX_SCHEMA_VERSION,
            tokens,
            signingKey: material.signingKey,
            credentialId: this.credentialId,
            address: this.address,
        };
        try {
            this.options.storage.save(record);
        } catch (error) {
            this.refreshPersistenceError =
                error instanceof Error ? error : new Error('Rotated Paybox OAuth tokens could not be persisted.');
            throw this.refreshPersistenceError;
        }
        this.assertCurrent(generation);
        this.material = refreshed;
        this.wallet = null;
        this.walletGeneration = null;
        this.generation += 1;
        if (this.credentialId !== null && this.address !== null) {
            this.wallet = this.options.sdk.createWallet(
                tokens,
                material.signingKey,
                this.credentialId,
                this.address,
                this.walletAuthority(refreshed, this.credentialId, this.address, this.generation),
            );
            this.walletGeneration = this.generation;
        }
    }

    private walletAuthority(
        candidate: PayboxAuthMaterial,
        credentialId: string,
        address: Address,
        generation: number,
    ): PayboxWalletAuthority {
        let authorityGeneration = generation;
        return {
            current: async () => {
                this.assertCurrent(generation);
                if (this.credentialId === credentialId && this.address === address) {
                    await this.refreshIfExpiring();
                    if (this.credentialId !== credentialId || this.address !== address || this.material === null) {
                        throw new Error('Paybox Wallet authority was invalidated.');
                    }
                    authorityGeneration = this.generation;
                    return this.material;
                }
                return candidate;
            },
            invalidate: () => {
                if (this.generation === authorityGeneration) this.resetAuthState();
            },
        };
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
