import { GET_LOT_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { summarizeLot } from '../format.utils.js';
import { getLotInputSchema } from '../types.js';

export function registerGetLotTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_lot',
        { description: GET_LOT_DESCRIPTION, inputSchema: getLotInputSchema },
        async (args) => {
            const lot = await context.trade.getLot(args.lotId);
            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: summarizeLot(lot, resources) },
                    { type: 'text', text: JSON.stringify(lot) },
                ],
            };
        },
    );
}
