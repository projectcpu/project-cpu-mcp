import { ONBOARDING_EXEMPT_TOOLS, ONBOARDING_GATE_REFUSAL, ONBOARDING_UNAVAILABLE_NOTICE } from './constants.js';
import {
    currentOnboardingStep,
    formatOnboardingNotice,
    isOnboardingFinished,
    isOnboardingStarted,
} from './onboarding.utils.js';
import { type IOnboardingService, OnboardingAvailability } from './types.js';
import type { AppContext } from '../types.js';
import { errorMessage } from '../utils/error.utils.js';
import type { ToolGate } from '../version/types.js';

export function createOnboardingGate(onboarding: IOnboardingService): ToolGate {
    return {
        check: async (toolName: string): Promise<Array<string>> => {
            if (ONBOARDING_EXEMPT_TOOLS.includes(toolName)) {
                return [];
            }

            const { availability, state } = await onboarding.state();
            if (availability === OnboardingAvailability.Unauthenticated) {
                return [];
            }
            if (availability === OnboardingAvailability.Unavailable || state === null) {
                return onboarding.takeUnavailableNotice() ? [ONBOARDING_UNAVAILABLE_NOTICE] : [];
            }
            if (isOnboardingFinished(state)) {
                return [];
            }
            if (!isOnboardingStarted(state)) {
                throw new Error(ONBOARDING_GATE_REFUSAL);
            }

            const step = currentOnboardingStep(state);
            return step === null ? [] : [formatOnboardingNotice(step)];
        },
    };
}

export async function refreshOnboarding(context: AppContext): Promise<void> {
    if (!context.config.OPERATOR_ONBOARDING) {
        return;
    }

    try {
        await context.onboarding.refresh();
    } catch (error) {
        context.logger.warn('could not refresh the onboarding state', { reason: errorMessage(error) });
    }
}
