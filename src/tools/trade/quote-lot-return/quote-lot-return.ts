import { QUOTE_LOT_RETURN_DESCRIPTION } from './constants.js';
import type { ILotReturnService } from '../../../services/lot-return.types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { createLotReturnService } from '../return-lot/factory.js';
import { summarizeLotReturnQuote } from '../return-lot/format.utils.js';
import { lotReturnQuoteInputSchema } from '../return-lot/types.js';

export function registerQuoteLotReturnTool(
    server: ToolRegistrar,
    context: AppContext,
    service: Pick<ILotReturnService, 'quoteReturn'> | null = null,
): void {
    // Built on first use, not at registration: registering a tool must not reach for the wallet.
    let returnService = service;
    const lotReturn = (): Pick<ILotReturnService, 'quoteReturn'> => (returnService ??= createLotReturnService(context));

    server.registerTool(
        'cpu_quote_lot_return',
        { description: QUOTE_LOT_RETURN_DESCRIPTION, inputSchema: lotReturnQuoteInputSchema },
        async (args) => {
            const quote = await lotReturn().quoteReturn({ lotId: args.lotId, chain: args.chain });
            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: summarizeLotReturnQuote(quote, resources) },
                    { type: 'text', text: JSON.stringify(quote) },
                ],
            };
        },
    );
}
