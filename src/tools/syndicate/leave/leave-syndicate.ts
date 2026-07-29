import { LEAVE_SYNDICATE_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeLeave } from '../format.utils.js';
import { leaveSyndicateInputSchema } from '../types.js';

export function registerLeaveSyndicateTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_leave_syndicate',
        { description: LEAVE_SYNDICATE_DESCRIPTION, inputSchema: leaveSyndicateInputSchema },
        async () => {
            const result = await context.syndicate.leave();

            return {
                content: [
                    { type: 'text', text: summarizeLeave(result) },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
