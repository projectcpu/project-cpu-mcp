import { SET_SYNDICATE_PARAMS_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { presentSyndicate } from '../presentation.utils.js';
import { setSyndicateParamsInputSchema, SyndicatePresentationKind } from '../types.js';

export function registerSetSyndicateParamsTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_set_syndicate_params',
        { description: SET_SYNDICATE_PARAMS_DESCRIPTION, inputSchema: setSyndicateParamsInputSchema },
        async (args) => {
            return presentSyndicate({
                kind: SyndicatePresentationKind.SetParams,
                value: await context.syndicate.setParams(args),
            });
        },
    );
}
