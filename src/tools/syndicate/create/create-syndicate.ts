import { CREATE_SYNDICATE_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { presentSyndicate } from '../presentation.utils.js';
import { createSyndicateInputSchema, SyndicatePresentationKind } from '../types.js';

export function registerCreateSyndicateTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_create_syndicate',
        { description: CREATE_SYNDICATE_DESCRIPTION, inputSchema: createSyndicateInputSchema },
        async (args) => {
            return presentSyndicate({
                kind: SyndicatePresentationKind.Create,
                value: await context.syndicate.create(args),
            });
        },
    );
}
