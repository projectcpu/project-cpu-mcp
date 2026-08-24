import { RETURN_LOT_DESCRIPTION } from './constants.js';
import { createLotReturnService } from './factory.js';
import { summarizeLotReturn } from './format.utils.js';
import { lotReturnInputSchema } from './types.js';
import type { ILotReturnService } from '../../../services/lot-return.types.js';
import type { AppContext } from '../../../types.js';
import { ToolEventType, type ToolRegistrar } from '../../types.js';

export function registerReturnLotTool(
    server: ToolRegistrar,
    context: AppContext,
    service: Pick<ILotReturnService, 'returnLot'> | null = null,
): void {
    // Built on first use, not at registration: registering a tool must not reach for the wallet.
    let returnService = service;
    const lotReturn = (): Pick<ILotReturnService, 'returnLot'> => (returnService ??= createLotReturnService(context));

    server.registerTool(
        'cpu_return_lot',
        { description: RETURN_LOT_DESCRIPTION, inputSchema: lotReturnInputSchema },
        async (args) => {
            const result = await lotReturn().returnLot({ lotId: args.lotId, chain: args.chain });
            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: summarizeLotReturn(result, resources) },
                    { type: 'text', text: JSON.stringify({ ...result, eventType: ToolEventType.LotReturned }) },
                ],
            };
        },
    );
}
