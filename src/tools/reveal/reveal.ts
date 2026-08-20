import { REVEAL_DESCRIPTION } from './constants.js';
import { revealInputSchema } from './types.js';
import type { RevealResult } from '../../services/types.js';
import type { AppContext } from '../../types.js';
import { ToolEventType, type ToolRegistrar } from '../types.js';

function requestLine(result: RevealResult): string {
    if (result.requestTxHash === null) {
        return `Cell ${result.tokenId} already carried a reveal request, so nothing new was requested and nothing was spent.`;
    }
    const approve = result.approveTxHash !== null ? ` approve tx ${result.approveTxHash},` : '';
    return (
        `Requested reveal for cell ${result.tokenId} — paid ${result.ethPaid} ETH and burned ${result.cpuBurn} ` +
        `$CPU, the price the cell quoted for this reveal.${approve} request tx ${result.requestTxHash} ` +
        `confirmed in block ${result.blockNumber}.`
    );
}

function requestIdLine(result: RevealResult): string | null {
    if (result.requestId === null) {
        return null;
    }
    const round = result.round !== null ? `, settled by beacon round ${result.round}` : '';
    const fulfil = result.fulfillTxHash !== null ? ` fulfil tx ${result.fulfillTxHash}.` : '';
    return `Reveal request ${result.requestId} at randomness source ${result.source}${round}.${fulfil}`;
}

function drawLine(result: RevealResult): string {
    if (result.deposits === null) {
        return result.note === null
            ? `Deposits are revealed — read them with get_cell ${result.tokenId}.`
            : `Read the draw with get_cell ${result.tokenId} once the map has caught up.`;
    }
    if (result.deposits.length === 0) {
        return `Deposits are revealed — the draw rolled nothing on cell ${result.tokenId}, which has no deposits to mine.`;
    }
    const drawn = result.deposits
        .map((deposit) => {
            const name = deposit.resourceName ?? 'resource';
            return `${deposit.amount} ${name} (#${deposit.resourceId}) at strength ${deposit.strength}`;
        })
        .join(', ');
    return `Deposits are revealed — cell ${result.tokenId} drew ${drawn}.`;
}

function outcomeLine(result: RevealResult): string {
    if (!result.fulfilled) {
        return (
            result.note ??
            `Deposits are drawn asynchronously by the randomness source and were not ready yet — poll get_cell ` +
                `${result.tokenId} shortly.`
        );
    }
    return result.note === null ? drawLine(result) : `${result.note} ${drawLine(result)}`;
}

export function registerRevealTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_reveal',
        { description: REVEAL_DESCRIPTION, inputSchema: revealInputSchema },
        async (args) => {
            const result = await context.reveal.reveal(args.tokenId);
            const header = [requestLine(result), requestIdLine(result), outcomeLine(result)]
                .filter((line): line is string => line !== null)
                .join(' ');

            return {
                content: [
                    { type: 'text', text: header },
                    {
                        type: 'text',
                        text: JSON.stringify({
                            ...result,
                            ...(result.fulfilled ? { eventType: ToolEventType.CellRevealed } : {}),
                        }),
                    },
                ],
            };
        },
    );
}
