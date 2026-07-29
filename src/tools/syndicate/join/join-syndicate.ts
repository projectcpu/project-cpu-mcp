import { JOIN_SYNDICATE_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeJoin } from '../format.utils.js';
import { joinSyndicateInputSchema } from '../types.js';

export function registerJoinSyndicateTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_join_syndicate',
        { description: JOIN_SYNDICATE_DESCRIPTION, inputSchema: joinSyndicateInputSchema },
        async (args) => {
            const result = await context.syndicate.join(args);

            return {
                content: [
                    { type: 'text', text: summarizeJoin(result) },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
