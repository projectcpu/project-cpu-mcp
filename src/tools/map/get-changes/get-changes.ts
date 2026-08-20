import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { labelCell } from '../label.utils.js';
import { getWalletAddress } from '../wallet.utils.js';
import { GET_CHANGES_DESCRIPTION } from './constants.js';
import { changeFeedPanel } from './panel.utils.js';
import { getChangesInputSchema } from './types.js';

export function registerGetChangesTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_get_changes',
        { description: GET_CHANGES_DESCRIPTION, inputSchema: getChangesInputSchema },
        async (args) => {
            const health = context.api.getServerHealth();
            const since = args.sinceVersion ?? 0;
            const changes = await context.mapReader.getChanges(since, getWalletAddress(context));
            const { resources } = await context.appConfig.load();

            const panel = changeFeedPanel({ since, changes, health });

            const labeled = {
                ...changes,
                changed: changes.changed.map((cell) => labelCell(cell, resources)),
                server: { reachable: health.reachable, reason: health.reason },
            };

            return {
                content: [
                    { type: 'text', text: panel },
                    { type: 'text', text: JSON.stringify(labeled) },
                ],
            };
        },
    );
}
