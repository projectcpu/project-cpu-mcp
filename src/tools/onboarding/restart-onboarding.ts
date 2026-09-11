import { ONBOARDING_RESTART_DONE_TEXT, RESTART_ONBOARDING_TOOL_DESCRIPTION } from './constants.js';
import { readOnboardingFacts } from './facts.utils.js';
import { onboardingReport } from './render.utils.js';
import { restartOnboardingInputSchema } from './types.js';
import { RESTART_ONBOARDING_TOOL_NAME } from '../../onboarding/constants.js';
import type { AppContext } from '../../types.js';
import type { ToolRegistrar } from '../types.js';

export function registerRestartOnboardingTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        RESTART_ONBOARDING_TOOL_NAME,
        { description: RESTART_ONBOARDING_TOOL_DESCRIPTION, inputSchema: restartOnboardingInputSchema },
        async (args) => {
            const status = await context.onboarding.restart(args.playerRequest);
            const facts = await readOnboardingFacts(context, status);

            return { content: onboardingReport(status, facts, ONBOARDING_RESTART_DONE_TEXT) };
        },
    );
}
