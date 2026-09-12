import { z } from 'zod';

import type { RequestOptions } from '../api/client.js';
import type { ApiResponse } from '../api/types.js';
import type { ILogger } from '../logger/types.js';

export enum OnboardingStep {
    Intro = 'intro',
    WalletAndCell = 'wallet_and_cell',
    Reveal = 'reveal',
    BuildExtractor = 'build_extractor',
    StartMining = 'start_mining',
    Tour = 'tour',
}

export enum OnboardingPhase {
    FirstReveal = 'first_reveal',
    Expansion = 'expansion',
}

export enum OnboardingAvailability {
    Ready = 'ready',
    Unauthenticated = 'unauthenticated',
    Unavailable = 'unavailable',
}

export interface OnboardingState {
    version: number;
    completedSteps: ReadonlyArray<string>;
    completedAt: number | null;
    skippedAt: number | null;
    skipReason: string | null;
}

export interface OnboardingStatus {
    availability: OnboardingAvailability;
    state: OnboardingState | null;
}

export const onboardingStateSchema = z.object({
    version: z.number(),
    completedSteps: z.array(z.string()),
    completedAt: z.number().nullable(),
    skippedAt: z.number().nullable(),
    skipReason: z.string().nullable(),
});

export interface IOnboardingService {
    state(): Promise<OnboardingStatus>;
    refresh(): Promise<OnboardingStatus>;
    completeStep(step: OnboardingStep): Promise<OnboardingStatus>;
    complete(): Promise<OnboardingStatus>;
    skip(reason: string): Promise<OnboardingStatus>;
    restart(reason: string): Promise<OnboardingStatus>;
}

export interface OnboardingApi {
    authenticatedRequest<T>(path: string, options: RequestOptions | null): Promise<ApiResponse<T>>;
}

export interface OnboardingSession {
    isAuthenticated(): boolean;
    address(): string | null;
}

export interface OnboardingServiceOptions {
    api: OnboardingApi;
    session: OnboardingSession;
    logger: ILogger;
}
