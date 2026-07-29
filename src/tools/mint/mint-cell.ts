import { MINT_CELL_DESCRIPTION } from './constants.js';
import { summarizeMint } from './format.utils.js';
import { mintInputSchema } from './types.js';
import type { AppContext } from '../../types.js';
import type { ToolRegistrar } from '../types.js';

export function registerMintCellTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_mint_cell',
        { description: MINT_CELL_DESCRIPTION, inputSchema: mintInputSchema },
        async (args) => {
            const result = await context.mint.mint({ quantity: args.quantity });

            return {
                content: [
                    { type: 'text', text: summarizeMint(result) },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
