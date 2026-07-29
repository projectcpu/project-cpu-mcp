import { GET_CRAFT_STATUS_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeCraftStatus } from '../format.utils.js';
import { craftCellInputSchema } from '../types.js';

export function registerGetCraftStatusTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_craft_status',
        { description: GET_CRAFT_STATUS_DESCRIPTION, inputSchema: craftCellInputSchema },
        async (args) => {
            const status = await context.craft.getStatus(args.tokenId);

            return {
                content: [
                    { type: 'text', text: summarizeCraftStatus(status) },
                    { type: 'text', text: JSON.stringify(status) },
                ],
            };
        },
    );
}
