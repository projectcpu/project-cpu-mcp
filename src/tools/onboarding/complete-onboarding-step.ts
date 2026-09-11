import { COMPLETE_ONBOARDING_STEP_TOOL_DESCRIPTION, ONBOARDING_STEP_CLOSED_PREFIX } from './constants.js';
import { readOnboardingFacts } from './facts.utils.js';
import { onboardingReport } from './render.utils.js';
import { completeOnboardingStepInputSchema } from './types.js';
import { COMPLETE_ONBOARDING_STEP_TOOL_NAME } from '../../onboarding/constants.js';
import { completeStepAndFinish } from '../../onboarding/onboarding.completion.js';
import type { AppContext } from '../../types.js';
import type { ToolRegistrar } from '../types.js';

export function registerCompleteOnboardingStepTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        COMPLETE_ONBOARDING_STEP_TOOL_NAME,
        {
            description: COMPLETE_ONBOARDING_STEP_TOOL_DESCRIPTION,
            inputSchema: completeOnboardingStepInputSchema,
        },
        async (args) => {
            const status = await completeStepAndFinish(context.onboarding, args.step);
            const facts = await readOnboardingFacts(context, status);
            const lead = `${ONBOARDING_STEP_CLOSED_PREFIX} \`${args.step}\`.`;

            return { content: onboardingReport(status, facts, lead) };
        },
    );
}
