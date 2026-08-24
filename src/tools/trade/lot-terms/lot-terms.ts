import { GET_LOT_TERMS_DESCRIPTION } from './constants.js';
import { createLotTermsService } from './factory.js';
import { summarizeLotTerms } from './format.utils.js';
import { getLotTermsInputSchema } from './types.js';
import type { ILotTerms } from '../../../services/lot-terms.types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';

export function registerGetLotTermsTool(
    server: ToolRegistrar,
    context: AppContext,
    injected: ILotTerms | null = null,
): void {
    // Built on first use, not at registration: registering a tool must not reach for the wallet.
    let lotTerms = injected;
    const terms = (): ILotTerms => (lotTerms ??= createLotTermsService(context));

    server.registerTool(
        'cpu_get_lot_terms',
        { description: GET_LOT_TERMS_DESCRIPTION, inputSchema: getLotTermsInputSchema },
        async (args) => {
            const live = await terms().getLotTerms({
                hubTokenId: String(args.hubTokenId),
                resourceId: args.resourceId,
            });
            const { resources } = await context.appConfig.load();

            return {
                content: [
                    { type: 'text', text: summarizeLotTerms(live, resources) },
                    { type: 'text', text: JSON.stringify(live) },
                ],
            };
        },
    );
}
