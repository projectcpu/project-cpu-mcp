import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeMiningStatus } from '../format.utils.js';
import { miningStatusInputSchema } from '../types.js';
import { GET_MINING_STATUS_DESCRIPTION } from './constants.js';

export function registerGetMiningStatusTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_mining_status',
        { description: GET_MINING_STATUS_DESCRIPTION, inputSchema: miningStatusInputSchema },
        async (args) => {
            const status = await context.mining.getStatus(args.tokenId);
            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: summarizeMiningStatus(status, resources) },
                    { type: 'text', text: JSON.stringify(status) },
                ],
            };
        },
    );
}
