import { BUILD_DESCRIPTION } from './constants.js';
import { buildPanel } from './panel.utils.js';
import { buildInputSchema } from './types.js';
import type { AppContext } from '../../types.js';
import { ToolEventType, type ToolRegistrar } from '../types.js';

export function registerBuildTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_build',
        { description: BUILD_DESCRIPTION, inputSchema: buildInputSchema },
        async (args) => {
            const result = await context.build.build({
                tokenId: args.tokenId,
                buildingType: args.buildingType,
            });
            const config = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: buildPanel({ result, config }) },
                    {
                        type: 'text',
                        text: JSON.stringify({
                            ...result,
                            ...(result.alreadyBuilt ? {} : { eventType: ToolEventType.BuildStarted }),
                        }),
                    },
                ],
            };
        },
    );
}
