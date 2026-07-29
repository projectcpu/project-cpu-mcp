import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { finalizeDeliveryInputSchema } from '../types.js';
import { FINALIZE_DELIVERY_DESCRIPTION } from './constants.js';

export function registerFinalizeDeliveryTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_finalize_delivery',
        { description: FINALIZE_DELIVERY_DESCRIPTION, inputSchema: finalizeDeliveryInputSchema },
        async (args) => {
            const result = await context.transport.finalize(args.ids);
            const header =
                `Finalized ${result.deliveryIds.length} delivery(ies) — tx ${result.txHash} confirmed in block ` +
                `${result.blockNumber}. Credited resources land at the target cells (read with get_cell).`;

            return {
                content: [
                    { type: 'text', text: header },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
