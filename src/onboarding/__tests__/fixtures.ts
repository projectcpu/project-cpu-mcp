import type { RequestOptions } from '../../api/client.js';
import type { ApiResponse } from '../../api/types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { OnboardingService } from '../onboarding.service.js';
import { type OnboardingApi, type OnboardingSession, type OnboardingState, OnboardingStep } from '../types.js';

export type ApiOutcome = { status: number; data: unknown } | { throws: Error };

export interface ApiCall {
    path: string;
    options: RequestOptions | null;
}

export class FakeApi implements OnboardingApi {
    public readonly calls: Array<ApiCall> = [];
    private outcome: ApiOutcome;

    constructor(outcome: ApiOutcome) {
        this.outcome = outcome;
    }

    setOutcome(outcome: ApiOutcome): void {
        this.outcome = outcome;
    }

    get paths(): Array<string> {
        return this.calls.map((call) => call.path);
    }

    async authenticatedRequest<T>(path: string, options: RequestOptions | null): Promise<ApiResponse<T>> {
        this.calls.push({ path, options });
        if ('throws' in this.outcome) {
            throw this.outcome.throws;
        }
        return { status: this.outcome.status, headers: new Headers(), data: this.outcome.data as T };
    }
}

export const EMPTY_STATE: OnboardingState = {
    version: 0,
    completedSteps: [],
    completedAt: null,
    skippedAt: null,
    skipReason: null,
};

export function stateWith(overrides: Partial<OnboardingState>): OnboardingState {
    return { ...EMPTY_STATE, ...overrides };
}

export function stateOk(overrides: Partial<OnboardingState>): ApiOutcome {
    return { status: 200, data: stateWith(overrides) };
}

export const FIRST_PHASE_STATE = stateWith({ version: 1, completedSteps: [OnboardingStep.Intro] });

export const SECOND_PHASE_STATE = stateWith({
    version: 1,
    completedSteps: [OnboardingStep.Intro, OnboardingStep.WalletAndCell, OnboardingStep.Reveal],
});

export const FINISHED_STATE = stateWith({
    version: 1,
    completedSteps: [
        OnboardingStep.Intro,
        OnboardingStep.WalletAndCell,
        OnboardingStep.Reveal,
        OnboardingStep.BuildExtractor,
        OnboardingStep.StartMining,
        OnboardingStep.Tour,
    ],
    completedAt: 1_700_000_000,
});

export const FIRST_ADDRESS = '0x00000000000000000000000000000000000000a1';
export const SECOND_ADDRESS = '0x00000000000000000000000000000000000000b2';

export class FakeSession implements OnboardingSession {
    public walletAddress = FIRST_ADDRESS;
    private readonly authenticated: boolean;

    constructor(authenticated = true) {
        this.authenticated = authenticated;
    }

    isAuthenticated(): boolean {
        return this.authenticated;
    }

    address(): string | null {
        return this.authenticated ? this.walletAddress : null;
    }
}

export function makeService(
    api: OnboardingApi,
    authenticated = true,
    session: FakeSession = new FakeSession(authenticated),
): OnboardingService {
    return new OnboardingService({ api, session, logger: new NoopLogger() });
}
