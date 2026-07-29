import { WITHDRAW_DESCRIPTION } from './constants.js';
import { withdrawInputSchema } from './types.js';
import type { AppContext } from '../../types.js';
import type { ToolRegistrar } from '../types.js';

export function registerWithdrawTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_withdraw',
        { description: WITHDRAW_DESCRIPTION, inputSchema: withdrawInputSchema },
        async (args) => {
            const result = await context.withdraw.withdraw({ tokenId: args.tokenId, amount: args.amount });

            const remainder = (BigInt(result.requested) - BigInt(result.executed)).toString();
            const header = result.partial
                ? `Withdrew from cell ${result.tokenId}: requested ${result.requested} but the $CPU emission budget ` +
                  `capped it — minted ${result.executed} $CPU to your wallet, ${remainder} wCPU stays in the cell. ` +
                  `Withdraw tx ${result.txHash} confirmed in block ${result.blockNumber}. Check it with get_balance.`
                : `Withdrew from cell ${result.tokenId}: minted ${result.executed} $CPU to your wallet — withdraw tx ` +
                  `${result.txHash} confirmed in block ${result.blockNumber}. Check it with get_balance.`;

            return {
                content: [
                    { type: 'text', text: header },
                    { type: 'text', text: JSON.stringify(result) },
                ],
            };
        },
    );
}
