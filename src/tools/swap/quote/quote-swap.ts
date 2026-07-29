import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { QUOTE_SWAP_DESCRIPTION } from '../constants.js';
import { summarizeSwapQuote } from '../format.utils.js';
import { quoteSwapInputSchema } from '../types.js';

export function registerQuoteSwapTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_quote_swap',
        { description: QUOTE_SWAP_DESCRIPTION, inputSchema: quoteSwapInputSchema },
        async (args) => {
            const quote = await context.swap.quote({
                sell: args.sell,
                amount: args.amount,
                slippage: args.slippage ?? 0.5,
            });

            return {
                content: [
                    { type: 'text', text: summarizeSwapQuote(quote) },
                    { type: 'text', text: JSON.stringify(quote) },
                ],
            };
        },
    );
}
