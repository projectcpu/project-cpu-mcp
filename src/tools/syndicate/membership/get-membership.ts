import { GET_SYNDICATE_MEMBERSHIP_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeMembership } from '../format.utils.js';
import { getSyndicateMembershipInputSchema } from '../types.js';

export function registerGetSyndicateMembershipTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_syndicate_membership',
        { description: GET_SYNDICATE_MEMBERSHIP_DESCRIPTION, inputSchema: getSyndicateMembershipInputSchema },
        async (args) => {
            const membership = await context.syndicate.getMembership(args);

            return {
                content: [
                    { type: 'text', text: summarizeMembership(membership) },
                    { type: 'text', text: JSON.stringify(membership) },
                ],
            };
        },
    );
}
