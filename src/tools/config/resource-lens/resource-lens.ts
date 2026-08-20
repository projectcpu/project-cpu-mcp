import { GET_RESOURCE_DESCRIPTION } from './constants.js';
import { buildResourceLens, renderResourceLens } from './resource-lens.utils.js';
import { getResourceInputSchema, type GetResourceArgs } from './types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';

export function registerGetResourceTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_resource',
        { description: GET_RESOURCE_DESCRIPTION, inputSchema: getResourceInputSchema },
        async (args: GetResourceArgs) => {
            const config = await context.appConfig.load();
            const lens = buildResourceLens(args.resourceId, config);

            return {
                content: [
                    { type: 'text', text: renderResourceLens(lens, config.resources) },
                    { type: 'text', text: JSON.stringify(lens) },
                ],
            };
        },
    );
}
