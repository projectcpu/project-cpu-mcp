import { JOIN_SYNDICATE_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { presentSyndicate } from '../presentation.utils.js';
import { joinSyndicateInputSchema, SyndicatePresentationKind } from '../types.js';

export function registerJoinSyndicateTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_join_syndicate',
        { description: JOIN_SYNDICATE_DESCRIPTION, inputSchema: joinSyndicateInputSchema },
        async (args) => {
            return presentSyndicate({
                kind: SyndicatePresentationKind.Join,
                value: await context.syndicate.join(args),
            });
        },
    );
}
