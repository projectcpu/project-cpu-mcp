import { CREATE_LOT_DESCRIPTION } from './constants.js';
import type { ILotTerms } from '../../../services/lot-terms.types.js';
import type { AppContext } from '../../../types.js';
import { ToolEventType, type ToolRegistrar } from '../../types.js';
import { summarizeCreateLot } from '../format.utils.js';
import { createLotTermsService } from '../lot-terms/factory.js';
import { createLotInputSchema } from '../types.js';

export function registerCreateLotTool(
    server: ToolRegistrar,
    context: AppContext,
    injected: ILotTerms | null = null,
): void {
    // Built on first use, not at registration: registering a tool must not reach for the wallet.
    let lotTerms = injected;
    const terms = (): ILotTerms => (lotTerms ??= createLotTermsService(context));

    server.registerTool(
        'cpu_create_lot',
        { description: CREATE_LOT_DESCRIPTION, inputSchema: createLotInputSchema },
        async (args) => {
            const hubTokenId = String(args.chain[args.chain.length - 1]);
            // Past this line the route is quoted, the transit fee approved and the transaction sent, so every
            // deterministic refusal has to happen before it or it has already cost the seller money.
            await terms().assertListingAllowed({
                hubTokenId,
                resourceId: args.resourceId,
                value: args.value,
                pricePerUnit: args.pricePerUnit,
                maxSaleFeePercent: args.maxSaleFeePercent,
            });

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
