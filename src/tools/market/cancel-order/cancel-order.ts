import { CANCEL_ORDER_DESCRIPTION } from './constants.js';
import { summarizeCancelledOrder } from './format.utils.js';
import { cancelOrderInputSchema, type CancelOrderContext } from './types.js';
import type { CancelOrderRequest } from '../../../services/market/cancel.types.js';
import { ToolEventType } from '../../types.js';
import { cancelOrderOutputSchema } from '../output.types.js';
import type { MarketToolDefinition } from '../types.js';

export function createCancelOrderTool(context: CancelOrderContext): MarketToolDefinition {
    return {
        name: 'cpu_cancel_order',
        description: CANCEL_ORDER_DESCRIPTION,
        inputSchema: cancelOrderInputSchema,
        outputSchema: cancelOrderOutputSchema,
        handler: async (args) => {
            const input = args as CancelOrderRequest;
            const result = await context.marketCancel.cancelOrder({ orderHash: input.orderHash });
            const output = { ...result, eventType: ToolEventType.MarketOrderCancelled };

            return {
                content: [
                    { type: 'text', text: summarizeCancelledOrder(result) },
                    {
                        type: 'text',
                        text: JSON.stringify(output),
                    },
                ],
                structuredContent: output,
            };
        },
    };
}
