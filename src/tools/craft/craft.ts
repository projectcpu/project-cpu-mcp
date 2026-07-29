import { CRAFT_DESCRIPTION } from './constants.js';
import { summarizeCraftStart } from './format.utils.js';
import { craftInputSchema } from './types.js';
import type { AppContext } from '../../types.js';
import type { ToolRegistrar } from '../types.js';

export function registerCraftTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_craft',
        { description: CRAFT_DESCRIPTION, inputSchema: craftInputSchema },
        async (args) => {
            const result = await context.craft.craft({
                tokenId: args.tokenId,
                recipeId: args.recipeId,
                batches: args.batches,
            });

            return {
                content: [
                    { type: 'text', text: summarizeCraftStart(result) },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
