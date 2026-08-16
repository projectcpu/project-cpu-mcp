import { GET_SYNDICATE_PLAYER_CONTENT_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { presentSyndicatePlayerContent } from '../presentation.utils.js';
import { getSyndicatePlayerContentInputSchema, syndicatePlayerContentOutputSchema } from '../types.js';

export function registerGetSyndicatePlayerContentTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_syndicate_player_content',
        {
            description: GET_SYNDICATE_PLAYER_CONTENT_DESCRIPTION,
            inputSchema: getSyndicatePlayerContentInputSchema,
            outputSchema: syndicatePlayerContentOutputSchema,
        },
        async ({ id }) => {
            return presentSyndicatePlayerContent(await context.syndicate.getPlayerContent(id));
        },
    );
}
