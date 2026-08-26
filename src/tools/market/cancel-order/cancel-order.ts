import { CANCEL_ORDER_DESCRIPTION } from './constants.js';
import { summarizeCancelledOrder } from './format.utils.js';
import { cancelOrderInputSchema, type CancelOrderContext } from './types.js';
import type { CancelOrderRequest } from '../../../services/market/cancel.types.js';
import { ToolEventType } from '../../types.js';
import type { MarketToolDefinition } from '../types.js';

export function createCancelOrderTool(context: CancelOrderContext): MarketToolDefinition {
    return {
        name: 'cpu_cancel_order',
        description: CANCEL_ORDER_DESCRIPTION,
        inputSchema: cancelOrderInputSchema,
        handler: async (args) => {
            const input = args as CancelOrderRequest;
            const result = await context.marketCancel.cancelOrder({ orderHash: input.orderHash });

            return {
                content: [
                    { type: 'text', text: summarizeCancelledOrder(result) },
                    {
                        type: 'text',
                        text: JSON.stringify({ ...result, eventType: ToolEventType.MarketOrderCancelled }),
                    },
                ],
            };
        },
    };
}
