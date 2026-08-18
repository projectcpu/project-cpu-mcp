import { LEAVE_SYNDICATE_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { presentSyndicate } from '../presentation.utils.js';
import { leaveSyndicateInputSchema, SyndicatePresentationKind } from '../types.js';

export function registerLeaveSyndicateTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_leave_syndicate',
        { description: LEAVE_SYNDICATE_DESCRIPTION, inputSchema: leaveSyndicateInputSchema },
        async () => {
            return presentSyndicate({
                kind: SyndicatePresentationKind.Leave,
                value: await context.syndicate.leave(),
            });
        },
    );
}
