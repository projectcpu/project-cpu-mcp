import { SWAP_DESCRIPTION } from './constants.js';
import { summarizeSwap } from './format.utils.js';
import { swapInputSchema } from './types.js';
import type { AppContext } from '../../types.js';
import type { ToolRegistrar } from '../types.js';

export function registerSwapTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool('cpu_swap', { description: SWAP_DESCRIPTION, inputSchema: swapInputSchema }, async (args) => {
        const result = await context.swap.swap({
            sell: args.sell,
            amount: args.amount,
            slippage: args.slippage ?? 0.5,
        });

        return {
            content: [
                { type: 'text', text: summarizeSwap(result) },
                { type: 'text', text: JSON.stringify(result) },
            ],
        };
    });
}
