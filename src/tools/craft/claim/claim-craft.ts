import { CLAIM_CRAFT_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeCraftClaim } from '../format.utils.js';
import { craftCellInputSchema } from '../types.js';

export function registerClaimCraftTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_claim_craft',
        { description: CLAIM_CRAFT_DESCRIPTION, inputSchema: craftCellInputSchema },
        async (args) => {
            const result = await context.craft.claim(args.tokenId);
            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: summarizeCraftClaim(result, resources) },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
