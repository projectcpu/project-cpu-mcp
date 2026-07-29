import { SET_SYNDICATE_PARAMS_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeSetParams } from '../format.utils.js';
import { setSyndicateParamsInputSchema } from '../types.js';

export function registerSetSyndicateParamsTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_set_syndicate_params',
        { description: SET_SYNDICATE_PARAMS_DESCRIPTION, inputSchema: setSyndicateParamsInputSchema },
        async (args) => {
            const result = await context.syndicate.setParams(args);

            return {
                content: [
                    { type: 'text', text: summarizeSetParams(result) },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
