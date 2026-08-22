import { UPGRADE_DESCRIPTION } from './constants.js';
import { upgradePanel } from './panel.utils.js';
import { upgradeInputSchema } from './types.js';
import type { AppContext } from '../../types.js';
import { ToolEventType, type ToolRegistrar } from '../types.js';

export function registerUpgradeTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_upgrade',
        { description: UPGRADE_DESCRIPTION, inputSchema: upgradeInputSchema },
        async (args) => {
            const result = await context.build.upgrade({
                tokenId: args.tokenId,
                targetBuildingType: args.targetBuildingType,
            });
            const config = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: upgradePanel({ result, config }) },
                    {
                        type: 'text',
                        text: JSON.stringify({
                            ...result,
                            ...(result.noop ? {} : { eventType: ToolEventType.UpgradeStarted }),
                        }),
                    },
                ],
            };
        },
    );
}
