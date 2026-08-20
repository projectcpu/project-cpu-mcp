import { CREATE_LOT_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import { ToolEventType, type ToolRegistrar } from '../../types.js';
import { summarizeCreateLot } from '../format.utils.js';
import { createLotInputSchema } from '../types.js';

export function registerCreateLotTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_create_lot',
        { description: CREATE_LOT_DESCRIPTION, inputSchema: createLotInputSchema },
        async (args) => {
            const result = await context.trade.createLot({
                chain: args.chain,
                resourceId: args.resourceId,
                value: args.value,
                pricePerUnit: args.pricePerUnit,
                maxSaleFeePercent: args.maxSaleFeePercent,
            });
            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: summarizeCreateLot(result, resources) },
                    { type: 'text', text: JSON.stringify({ ...result, eventType: ToolEventType.LotCreated }) },
                ],
            };
        },
    );
}
