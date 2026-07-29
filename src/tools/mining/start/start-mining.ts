import { START_MINING_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeMiningStart } from '../format.utils.js';
import { startMiningInputSchema } from '../types.js';

export function registerStartMiningTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_start_mining',
        { description: START_MINING_DESCRIPTION, inputSchema: startMiningInputSchema },
        async (args) => {
            const result = await context.mining.startMining({
                tokenId: args.tokenId,
                targetResourceId: args.targetResourceId,
                batches: args.batches,
            });
            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: summarizeMiningStart(result, resources) },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
