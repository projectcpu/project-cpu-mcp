import { LIST_SYNDICATES_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { presentSyndicate } from '../presentation.utils.js';
import { listSyndicatesInputSchema, SyndicatePresentationKind } from '../types.js';

export function registerListSyndicatesTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_list_syndicates',
        { description: LIST_SYNDICATES_DESCRIPTION, inputSchema: listSyndicatesInputSchema },
        async (args) => {
            return presentSyndicate({
                kind: SyndicatePresentationKind.List,
                value: await context.syndicate.listSyndicates(args),
            });
        },
    );
}
