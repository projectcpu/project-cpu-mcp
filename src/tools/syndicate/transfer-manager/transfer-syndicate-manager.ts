import { TRANSFER_SYNDICATE_MANAGER_DESCRIPTION } from './constants.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { presentSyndicate } from '../presentation.utils.js';
import { SyndicatePresentationKind, transferSyndicateManagerInputSchema } from '../types.js';

export function registerTransferSyndicateManagerTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_transfer_syndicate_manager',
        { description: TRANSFER_SYNDICATE_MANAGER_DESCRIPTION, inputSchema: transferSyndicateManagerInputSchema },
        async (args) => {
            return presentSyndicate({
                kind: SyndicatePresentationKind.TransferManager,
                value: await context.syndicate.transferManager(args),
            });
        },
    );
}
