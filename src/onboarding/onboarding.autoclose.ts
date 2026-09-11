import { completeStepAndFinish } from './onboarding.completion.js';
import { isOnboardingFinished } from './onboarding.utils.js';
import { OnboardingAvailability, type OnboardingStep } from './types.js';
import type { AppContext } from '../types.js';
import { errorMessage } from '../utils/error.utils.js';

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

        await completeStepAndFinish(context.onboarding, step);
    } catch (error) {
        context.logger.warn('could not record the onboarding step', { step, reason: errorMessage(error) });
    }
}
