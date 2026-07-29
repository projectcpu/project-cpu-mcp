import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeQuote } from '../format.utils.js';
import { transportInputSchema } from '../types.js';
import { QUOTE_TRANSPORT_DESCRIPTION } from './constants.js';

export function registerQuoteTransportTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_quote_transport',
        { description: QUOTE_TRANSPORT_DESCRIPTION, inputSchema: transportInputSchema },
        async (args) => {
            const quote = await context.transport.quote({
                path: args.path,
                resourceId: args.resourceId,
                amount: args.amount,
            });

            return {
                content: [
                    { type: 'text', text: summarizeQuote(quote) },
                    { type: 'text', text: JSON.stringify(quote) },
                ],
            };
        },
    );
}
