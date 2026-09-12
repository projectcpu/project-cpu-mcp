import {
    ONBOARDING_COMPLETE_PATH,
    ONBOARDING_RESTART_PATH,
    ONBOARDING_SKIP_PATH,
    ONBOARDING_STATE_PATH,
    ONBOARDING_STEP_ORDER,
    ONBOARDING_STEP_PATH,
    ONBOARDING_VERSION,
} from './constants.js';
import { isSuccessStatus, normalizeOnboardingStatePayload } from './onboarding.utils.js';
import {
    OnboardingAvailability,
    type IOnboardingService,
    type OnboardingApi,
    type OnboardingServiceOptions,
    type OnboardingSession,
    type OnboardingState,
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
const READ_LABEL = 'read the onboarding state';

export class OnboardingService implements IOnboardingService {
    private readonly api: OnboardingApi;
    private readonly session: OnboardingSession;
    private readonly logger: ILogger;
    private cache: { address: string | null; status: OnboardingStatus } | null = null;
    private inFlight: Promise<OnboardingStatus> | null = null;

    constructor(options: OnboardingServiceOptions) {
        this.api = options.api;
        this.session = options.session;
        this.logger = options.logger;
    }

    async state(): Promise<OnboardingStatus> {
        if (this.cache !== null && this.cache.address === this.session.address()) {
            return this.cache.status;
        }
        if (!this.session.isAuthenticated()) {
            return UNAUTHENTICATED;
        }

        this.inFlight ??= this.fetchState().finally(() => {
            this.inFlight = null;
        });
        return this.inFlight;
    }

    async refresh(): Promise<OnboardingStatus> {
        this.cache = null;
        return this.state();
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

    async restart(_reason: string): Promise<OnboardingStatus> {
        return this.write(ONBOARDING_RESTART_PATH, { version: ONBOARDING_VERSION }, 'restart the onboarding');
    }

    private async fetchState(): Promise<OnboardingStatus> {
        try {
            const response = await this.api.authenticatedRequest<unknown>(ONBOARDING_STATE_PATH, null);
            return this.remember({
                availability: OnboardingAvailability.Ready,
                state: this.parseState(response, READ_LABEL),
            });
        } catch (error) {
            if (error instanceof AuthenticationRequiredError) {
                return UNAUTHENTICATED;
            }
            return this.unavailable(errorMessage(error));
        }
    }

    private async write(path: string, body: unknown, label: string): Promise<OnboardingStatus> {
        const response = await this.api.authenticatedRequest<unknown>(path, { method: 'POST', body });
        return this.remember({ availability: OnboardingAvailability.Ready, state: this.parseState(response, label) });
    }

    private parseState(response: ApiResponse<unknown>, label: string): OnboardingState {
        if (!isSuccessStatus(response.status)) {
            throw new Error(`Could not ${label} (HTTP ${response.status}): ${describeApiError(response.data)}`);
        }

        const parsed = onboardingStateSchema.safeParse(normalizeOnboardingStatePayload(response.data));
        if (!parsed.success) {
            throw new Error(`Could not ${label}: the game API answered an unreadable onboarding state.`);
        }

        return parsed.data;
    }

    private unavailable(reason: string): OnboardingStatus {
        this.logger.warn('onboarding state unavailable — continuing without it', { reason });
        return this.remember({ availability: OnboardingAvailability.Unavailable, state: null });
    }

    private remember(status: OnboardingStatus): OnboardingStatus {
        this.cache = { address: this.session.address(), status };
        return status;
    }
}
