import { GET_SYNDICATE_PLAYER_CONTENT_DESCRIPTION, PLAYER_CONTENT_WARNING } from './constants.js';
import type { AppContext } from '../../../types.js';
import { safeJsonStringify } from '../../../utils/safe-json.utils.js';
import type { ToolRegistrar } from '../../types.js';
import { toSyndicatePlayerContentOutput } from '../player-content.utils.js';
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
            const output = toSyndicatePlayerContentOutput(await context.syndicate.getPlayerContent(id));
            return {
                content: [
                    { type: 'text', text: PLAYER_CONTENT_WARNING },
                    { type: 'text', text: safeJsonStringify(output) },
                ],
                structuredContent: output,
            };
        },
    );
}
