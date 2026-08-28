import { PAYBOX_AUTH_REQUIRED_INSTRUCTIONS } from '../constants.js';
import { PayboxAuthority } from './authority.js';
import { PayboxAuthFlowSession } from './flow-session.js';
import { PayboxAuthFlowPollStatus } from './types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type { ILogger } from '../../logger/types.js';
import type { WalletManager, WalletProvider } from '../../wallet/types.js';
import {
    PayboxAuthFlowError,
    PayboxAuthInvalidError,
    PayboxTemporarilyUnavailableError,
    PayboxWalletSelectionError,
} from '../errors.js';
import {
    PayboxAuthStatus,
    PayboxErrorCode,
    type PayboxAuthenticateInput,
    type PayboxAuthenticateResult,
    type PayboxCoordinatorOptions,
} from '../types.js';

/** The sole lifecycle owner: auth transport returns material, this module decides persistence and selection. */
export class PayboxCoordinator implements WalletProvider {
    private readonly authFlow: PayboxAuthFlowSession;
    private readonly authority: PayboxAuthority;
    private forcing: Promise<PayboxAuthenticateResult> | null = null;

    constructor(
        options: PayboxCoordinatorOptions,
        private readonly logger: ILogger = new NoopLogger(),
    ) {
        this.authFlow = new PayboxAuthFlowSession(options.flow);
        this.authority = new PayboxAuthority(
            { storage: options.storage, sdk: options.sdk, authenticator: options.authenticator },
            () => this.authFlow.reset(),
        );
    }

    isReady(): boolean {
        return this.authority.isReady();
    }

    get(): WalletManager {
        return this.authority.get();
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
            return await this.advanceAuthentication(requestedCredentialId);
        } catch (error) {
            if (error instanceof PayboxAuthInvalidError) {
                this.logger.warn('Paybox authentication authority invalidated', { ...error.diagnostic });
                this.resetAuthState();
                return this.advanceAuthentication(null);
            }
            if (error instanceof PayboxAuthFlowError || error instanceof PayboxTemporarilyUnavailableError) {
                this.logger.warn('Paybox authentication request failed', { ...error.diagnostic });
            }
            throw error;
        }
    }

    private advanceAuthentication(requestedCredentialId: string | null): Promise<PayboxAuthenticateResult> {
        if (this.authFlow.isActive()) return this.pollAuthFlow(requestedCredentialId);
        if (this.authority.hasMaterial()) return this.authority.authenticate(null, requestedCredentialId);
        return this.pollAuthFlow(requestedCredentialId);
    }

    private async pollAuthFlow(requestedCredentialId: string | null): Promise<PayboxAuthenticateResult> {
        if (requestedCredentialId !== null) {
            throw new PayboxWalletSelectionError(PayboxErrorCode.WalletSelectionNotPending);
        }
        const result = await this.authFlow.poll((material) => this.authority.authenticate(material, null));
        if (result.status === PayboxAuthFlowPollStatus.Completed) return result.result;
        return {
            status: PayboxAuthStatus.AuthRequired,
            instructions: PAYBOX_AUTH_REQUIRED_INSTRUCTIONS,
            authorizationUrl: result.authorizationUrl,
        };
    }

    private resetAuthState(): void {
        this.authFlow.reset();
        this.authority.reset();
    }
}
