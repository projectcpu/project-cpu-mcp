import { SET_SALE_FEE_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import { ToolEventType, type ToolRegistrar } from '../../types.js';
import { summarizeSetSaleFee } from '../format.utils.js';
import { setSaleFeeInputSchema } from '../types.js';

export function registerSetSaleFeeTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_set_sale_fee',
        { description: SET_SALE_FEE_DESCRIPTION, inputSchema: setSaleFeeInputSchema },
        async (args) => {
            const result = await context.trade.setSaleFee({
                hubTokenId: String(args.hubTokenId),
                resourceId: args.resourceId,
                feePercent: args.feePercent,
            });
            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: summarizeSetSaleFee(result, resources) },
                    { type: 'text', text: JSON.stringify({ ...result, eventType: ToolEventType.HubFeeSet }) },
                ],
            };
        },
    );
}
