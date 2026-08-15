import { CREATE_SYNDICATE_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeCreate } from '../format.utils.js';
import { createSyndicateOutput } from '../output.utils.js';
import { createSyndicateInputSchema } from '../types.js';

export function registerCreateSyndicateTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_create_syndicate',
        { description: CREATE_SYNDICATE_DESCRIPTION, inputSchema: createSyndicateInputSchema },
        async (args) => {
            const result = createSyndicateOutput(await context.syndicate.create(args));

            return {
                content: [
                    { type: 'text', text: summarizeCreate(result) },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
