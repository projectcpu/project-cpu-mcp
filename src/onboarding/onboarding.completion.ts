import { currentOnboardingStep, isOnboardingFinished } from './onboarding.utils.js';
import type { IOnboardingService, OnboardingStatus, OnboardingStep } from './types.js';

export async function completeStepAndFinish(
    service: IOnboardingService,
    step: OnboardingStep,
): Promise<OnboardingStatus> {
    const status = await service.completeStep(step);
    const state = status.state;
    if (state === null || isOnboardingFinished(state)) {
        return status;
    }
    return currentOnboardingStep(state) === null ? service.complete() : status;
}
