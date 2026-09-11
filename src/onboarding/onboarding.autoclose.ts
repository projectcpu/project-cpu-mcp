import { ONBOARDING_STEP_ORDER } from './constants.js';
import { isOnboardingFinished } from './onboarding.utils.js';
import { OnboardingAvailability, type OnboardingState, type OnboardingStep } from './types.js';
import type { AppContext } from '../types.js';
import { errorMessage } from '../utils/error.utils.js';

function allStepsClosed(state: OnboardingState): boolean {
    return ONBOARDING_STEP_ORDER.every((step) => state.completedSteps.includes(step));
}

export async function closeOnboardingStep(context: AppContext, step: OnboardingStep): Promise<void> {
    if (!context.config.OPERATOR_ONBOARDING) {
        return;
    }

    try {
        const known = await context.onboarding.state();
        if (known.availability !== OnboardingAvailability.Ready || known.state === null) {
            return;
        }
        if (isOnboardingFinished(known.state) || known.state.completedSteps.includes(step)) {
            return;
        }

        const { state } = await context.onboarding.completeStep(step);
        if (state !== null && !isOnboardingFinished(state) && allStepsClosed(state)) {
            await context.onboarding.complete();
        }
    } catch (error) {
        context.logger.warn('could not record the onboarding step', { step, reason: errorMessage(error) });
    }
}
