import { BUY_LOT_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeBuyLot } from '../format.utils.js';
import { buyLotInputSchema } from '../types.js';

export function registerBuyLotTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_buy_lot',
        { description: BUY_LOT_DESCRIPTION, inputSchema: buyLotInputSchema },
        async (args) => {
            const result = await context.trade.buyLot({
                lotId: args.lotId,
                chain: args.chain,
                value: args.value,
            });
            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: summarizeBuyLot(result, resources) },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
