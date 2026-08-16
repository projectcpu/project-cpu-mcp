import { GET_SYNDICATE_MEMBERSHIP_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { presentSyndicate } from '../presentation.utils.js';
import { getSyndicateMembershipInputSchema, SyndicatePresentationKind } from '../types.js';

export function registerGetSyndicateMembershipTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_syndicate_membership',
        { description: GET_SYNDICATE_MEMBERSHIP_DESCRIPTION, inputSchema: getSyndicateMembershipInputSchema },
        async (args) => {
            return presentSyndicate({
                kind: SyndicatePresentationKind.Membership,
                value: await context.syndicate.getMembership(args),
            });
        },
    );
}
