import { ONBOARDING_SKIP_DONE_TEXT, SKIP_ONBOARDING_TOOL_DESCRIPTION } from './constants.js';
import { readOnboardingFacts } from './facts.utils.js';
import { onboardingReport } from './render.utils.js';
import { skipOnboardingInputSchema } from './types.js';
import { SKIP_ONBOARDING_TOOL_NAME } from '../../onboarding/constants.js';
import type { AppContext } from '../../types.js';
import type { ToolRegistrar } from '../types.js';

export function registerSkipOnboardingTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        SKIP_ONBOARDING_TOOL_NAME,
        { description: SKIP_ONBOARDING_TOOL_DESCRIPTION, inputSchema: skipOnboardingInputSchema },
        async (args) => {
            const status = await context.onboarding.skip(args.playerRequest);
            const facts = await readOnboardingFacts(context, status);

            return { content: onboardingReport(status, facts, ONBOARDING_SKIP_DONE_TEXT) };
        },
    );
}
