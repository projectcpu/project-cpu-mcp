import { GET_SYNDICATE_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeSyndicateDetail } from '../format.utils.js';
import { getSyndicateInputSchema } from '../types.js';

export function registerGetSyndicateTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_syndicate',
        { description: GET_SYNDICATE_DESCRIPTION, inputSchema: getSyndicateInputSchema },
        async (args) => {
            const detail = await context.syndicate.getSyndicate(args);

            return {
                content: [
                    { type: 'text', text: summarizeSyndicateDetail(detail) },
                    { type: 'text', text: JSON.stringify(detail) },
                ],
            };
        },
    );
}
