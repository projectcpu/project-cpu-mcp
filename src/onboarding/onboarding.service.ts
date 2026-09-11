import {
    ONBOARDING_COMPLETE_PATH,
    ONBOARDING_RESTART_PATH,
    ONBOARDING_SKIP_PATH,
    ONBOARDING_STATE_PATH,
    ONBOARDING_STEP_ORDER,
    ONBOARDING_STEP_PATH,
    ONBOARDING_VERSION,
} from './constants.js';
import {
    currentOnboardingStep,
    isOnboardingFinished,
    isOnboardingStarted,
    isSuccessStatus,
    normalizeOnboardingStatePayload,
    onboardingPhase,
} from './onboarding.utils.js';
import {
    OnboardingAvailability,
    type IOnboardingService,
    type OnboardingApi,
    type OnboardingPhase,
    type OnboardingServiceOptions,
    type OnboardingSession,
    onboardingStateSchema,
    type OnboardingStatus,
    type OnboardingStep,
} from './types.js';
import { AuthenticationRequiredError } from '../api/authentication-required.error.js';
import { describeApiError } from '../api/response.utils.js';
import type { ApiResponse } from '../api/types.js';
import type { ILogger } from '../logger/types.js';
import { errorMessage } from '../utils/error.utils.js';

const UNAUTHENTICATED: OnboardingStatus = { availability: OnboardingAvailability.Unauthenticated, state: null };

export class OnboardingService implements IOnboardingService {
    private readonly api: OnboardingApi;
    private readonly session: OnboardingSession;
    private readonly logger: ILogger;
    private cached: OnboardingStatus | null = null;
    private cachedAddress: string | null = null;
    private inFlight: Promise<OnboardingStatus> | null = null;
    private unavailableNotice = false;

    constructor(options: OnboardingServiceOptions) {
        this.api = options.api;
        this.session = options.session;
        this.logger = options.logger;
    }

    async state(): Promise<OnboardingStatus> {
        return this.cachedForCurrentAddress() ?? this.load();
    }

    async refresh(): Promise<OnboardingStatus> {
        this.cached = null;
        return this.load();
    }

    async completeStep(step: OnboardingStep): Promise<OnboardingStatus> {
        return this.write(
            ONBOARDING_STEP_PATH,
            { version: ONBOARDING_VERSION, step },
            `close the onboarding step ${step}`,
        );
    }

    async complete(): Promise<OnboardingStatus> {
        return this.write(ONBOARDING_COMPLETE_PATH, { version: ONBOARDING_VERSION }, 'complete the onboarding');
    }

    async skip(reason: string): Promise<OnboardingStatus> {
        return this.write(
            ONBOARDING_SKIP_PATH,
            { version: ONBOARDING_VERSION, reason, steps: [...ONBOARDING_STEP_ORDER] },
            'skip the onboarding',
        );
    }

    async restart(reason: string): Promise<OnboardingStatus> {
        this.logger.info('restarting the onboarding at the player request', { reason });
        return this.write(ONBOARDING_RESTART_PATH, { version: ONBOARDING_VERSION }, 'restart the onboarding');
    }

    async currentStep(): Promise<OnboardingStep | null> {
        const { state } = await this.state();
        return state === null ? null : currentOnboardingStep(state);
    }

    async phase(): Promise<OnboardingPhase | null> {
        const { state } = await this.state();
        return state === null ? null : onboardingPhase(state);
    }

    async isFinished(): Promise<boolean> {
        const { state } = await this.state();
        return state !== null && isOnboardingFinished(state);
    }

    async isStarted(): Promise<boolean> {
        const { state } = await this.state();
        return state !== null && isOnboardingStarted(state);
    }

    takeUnavailableNotice(): boolean {
        const pending = this.unavailableNotice;
        this.unavailableNotice = false;
        return pending;
    }

    private currentAddress(): string | null {
        try {
            return this.session.getSession().address.toLowerCase();
        } catch {
            return null;
        }
    }

    private cachedForCurrentAddress(): OnboardingStatus | null {
        if (this.cached === null || this.cachedAddress !== this.currentAddress()) {
            return null;
        }
        return this.cached;
    }

    private async load(): Promise<OnboardingStatus> {
        if (!this.session.isAuthenticated()) {
            return UNAUTHENTICATED;
        }
        if (this.inFlight !== null) {
            return this.inFlight;
        }

        const flight = this.fetchState();
        this.inFlight = flight;
        try {
            return await flight;
        } finally {
            this.inFlight = null;
        }
    }

    private async fetchState(): Promise<OnboardingStatus> {
        let response: ApiResponse<unknown>;
        try {
            response = await this.api.authenticatedRequest<unknown>(ONBOARDING_STATE_PATH, null);
        } catch (error) {
            if (error instanceof AuthenticationRequiredError) {
                return UNAUTHENTICATED;
            }
            return this.unavailable(errorMessage(error));
        }

        if (!isSuccessStatus(response.status)) {
            return this.unavailable(`the game API answered HTTP ${response.status}`);
        }

        const parsed = onboardingStateSchema.safeParse(normalizeOnboardingStatePayload(response.data));
        if (!parsed.success) {
            return this.unavailable('the game API answered an unreadable onboarding state');
        }

        return this.remember({ availability: OnboardingAvailability.Ready, state: parsed.data });
    }

    private async write(path: string, body: unknown, label: string): Promise<OnboardingStatus> {
        const response = await this.api.authenticatedRequest<unknown>(path, { method: 'POST', body });

        if (!isSuccessStatus(response.status)) {
            throw new Error(`Could not ${label} (HTTP ${response.status}): ${describeApiError(response.data)}`);
        }

        const parsed = onboardingStateSchema.safeParse(normalizeOnboardingStatePayload(response.data));
        if (!parsed.success) {
            throw new Error(`Could not ${label}: the game API answered an unreadable onboarding state.`);
        }

        return this.remember({ availability: OnboardingAvailability.Ready, state: parsed.data });
    }

    private unavailable(reason: string): OnboardingStatus {
        this.logger.warn('onboarding state unavailable — continuing without it', { reason });
        this.unavailableNotice = true;
        return this.remember({ availability: OnboardingAvailability.Unavailable, state: null });
    }

    private remember(status: OnboardingStatus): OnboardingStatus {
        this.cached = status;
        this.cachedAddress = this.currentAddress();
        return status;
    }
}
