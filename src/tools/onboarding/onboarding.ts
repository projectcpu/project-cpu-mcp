import { ONBOARDING_TOOL_DESCRIPTION } from './constants.js';
import { readOnboardingFacts } from './facts.utils.js';
import { onboardingReport } from './render.utils.js';
import { ONBOARDING_TOOL_NAME } from '../../onboarding/constants.js';
import type { AppContext } from '../../types.js';
import type { ToolRegistrar } from '../types.js';

export function registerOnboardingTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        ONBOARDING_TOOL_NAME,
        { description: ONBOARDING_TOOL_DESCRIPTION, inputSchema: {} },
        async () => {
            const status = await context.onboarding.state();
            const facts = await readOnboardingFacts(context, status);

            return { content: onboardingReport(status, facts, null) };
        },
    );
}
