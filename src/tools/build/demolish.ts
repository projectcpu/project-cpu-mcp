import { DEMOLISH_DESCRIPTION } from './constants.js';
import { demolishInputSchema } from './types.js';
import type { AppContext } from '../../types.js';
import { formatStacks, formatUnixSeconds } from '../../utils/format.utils.js';
import type { ToolRegistrar } from '../types.js';

export function registerDemolishTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_demolish',
        { description: DEMOLISH_DESCRIPTION, inputSchema: demolishInputSchema },
        async (args) => {
            const result = await context.build.demolish({ tokenId: args.tokenId });
            const { resources } = await context.appConfig.load();

            const consumed = formatStacks(resources, result.inputsConsumed);
            const consumedNote = consumed.length > 0 ? ` plus ${consumed} from its warehouse` : '';
            const lockNote =
                result.rebuildUnlockAt !== null
                    ? `The plot is locked from rebuilding until ${formatUnixSeconds(result.rebuildUnlockAt)} ` +
                      `(~${result.rebuildCooldownSec}s).`
                    : 'The plot is locked from rebuilding; the exact demolishFinishAt settles on the map shortly.';
            const header =
                `Demolished the ${result.buildingType} on cell ${result.tokenId}: burned ${result.cpuBurned} $CPU` +
                `${consumedNote}. ${lockNote} tx ${result.txHash} confirmed in block ${result.blockNumber}.`;

            return {
                content: [
                    { type: 'text', text: header },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
