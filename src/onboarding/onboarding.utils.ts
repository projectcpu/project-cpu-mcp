import {
    ONBOARDING_FIRST_PHASE_PRIORITY,
    ONBOARDING_FIRST_PHASE_STEPS,
    ONBOARDING_NOTICE_CALL,
    ONBOARDING_NOTICE_PREFIX,
    ONBOARDING_NOTICE_SEPARATOR,
    ONBOARDING_STEP_ORDER,
} from './constants.js';
import { OnboardingPhase, OnboardingStep, type OnboardingState } from './types.js';
import { HTTP_MULTIPLE_CHOICES, HTTP_OK } from '../api/constants.js';

export function isSuccessStatus(status: number): boolean {
    return status >= HTTP_OK && status < HTTP_MULTIPLE_CHOICES;
}

export function isOnboardingStep(value: string): value is OnboardingStep {
    return ONBOARDING_STEP_ORDER.includes(value as OnboardingStep);
}

export function isOnboardingFinished(state: OnboardingState): boolean {
    return state.completedAt !== null;
}

export function currentOnboardingStep(state: OnboardingState): OnboardingStep | null {
    if (isOnboardingFinished(state)) {
        return null;
    }
    return ONBOARDING_STEP_ORDER.find((step) => !state.completedSteps.includes(step)) ?? null;
}

export function isOnboardingStarted(state: OnboardingState): boolean {
    return isOnboardingFinished(state) || state.completedSteps.includes(OnboardingStep.Intro);
}

export function onboardingPhaseOf(step: OnboardingStep): OnboardingPhase {
    return ONBOARDING_FIRST_PHASE_STEPS.includes(step) ? OnboardingPhase.FirstReveal : OnboardingPhase.Expansion;
}

export function onboardingPhase(state: OnboardingState): OnboardingPhase | null {
    const step = currentOnboardingStep(state);
    return step === null ? null : onboardingPhaseOf(step);
}

export function formatOnboardingNotice(step: OnboardingStep): string {
    const position = ONBOARDING_STEP_ORDER.indexOf(step) + 1;
    const notice = [
        `${ONBOARDING_NOTICE_PREFIX} ${position}/${ONBOARDING_STEP_ORDER.length} \`${step}\``,
        ONBOARDING_NOTICE_CALL,
    ];
    if (onboardingPhaseOf(step) === OnboardingPhase.FirstReveal) {
        notice.push(ONBOARDING_FIRST_PHASE_PRIORITY);
    }
    return notice.join(ONBOARDING_NOTICE_SEPARATOR);
}
