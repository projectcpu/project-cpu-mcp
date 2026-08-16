import { GET_SYNDICATE_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { presentSyndicate } from '../presentation.utils.js';
import { getSyndicateInputSchema, SyndicatePresentationKind } from '../types.js';

export function registerGetSyndicateTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_syndicate',
        { description: GET_SYNDICATE_DESCRIPTION, inputSchema: getSyndicateInputSchema },
        async (args) => {
            return presentSyndicate({
                kind: SyndicatePresentationKind.Detail,
                value: await context.syndicate.getSyndicate(args),
            });
        },
    );
}
