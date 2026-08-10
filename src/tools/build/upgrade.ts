import { UPGRADE_DESCRIPTION } from './constants.js';
import { upgradeInputSchema } from './types.js';
import type { AppConfig, UpgradeResult } from '../../services/types.js';
import type { AppContext } from '../../types.js';
import { formatStacks, formatUnixSeconds } from '../../utils/format.utils.js';
import type { ToolRegistrar } from '../types.js';

export function registerUpgradeTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_upgrade',
        { description: UPGRADE_DESCRIPTION, inputSchema: upgradeInputSchema },
        async (args) => {
            const result = await context.build.upgrade({
                tokenId: args.tokenId,
                targetBuildingType: args.targetBuildingType,
            });
            const config = await context.appConfig.load();
            const header = result.noop ? noopHeader(result) : submittedHeader(result, config);

            return {
                content: [
                    { type: 'text', text: header },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}

function finishNote(result: UpgradeResult): string {
    return result.finishAt !== null
        ? `finishes ${formatUnixSeconds(result.finishAt)}`
        : 'the exact finish time settles on the map shortly';
}

function noopHeader(result: UpgradeResult): string {
    const status = result.upgrading ? `still upgrading (${finishNote(result)})` : 'ready';
    return `Cell ${result.tokenId} already has ${result.toBuildingType} installed — no transaction was sent. It is ${status}.`;
}

function submittedHeader(result: UpgradeResult, config: AppConfig): string {
    const approve = result.approveTxHash !== null ? `approve tx ${result.approveTxHash}; ` : '';
    const inputs = formatStacks(config.resources, result.buildInputs);
    const inputsNote = inputs.length > 0 ? `, plus ${inputs} from its warehouse` : '';
    return (
        `Upgrading cell ${result.tokenId} from ${result.fromBuildingType} to ${result.toBuildingType}: ` +
        `${approve}upgrade tx ${result.txHash} (paid ${result.buildCost} $CPU${inputsNote}). ` +
        `Construction started — ${finishNote(result)}. Production and Hub functionality are unavailable until ` +
        `construction completes.`
    );
}
