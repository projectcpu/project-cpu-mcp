import { FULFILL_REVEAL_DESCRIPTION } from './constants.js';
import { fulfillRevealInputSchema } from './types.js';
import {
    type FulfillRevealInput,
    type RevealFulfilmentEntry,
    RevealFulfilmentOutcome,
    type RevealFulfilmentReport,
} from '../../services/types.js';
import type { AppContext } from '../../types.js';
import { ToolEventType, type ToolRegistrar } from '../types.js';

const OUTCOME_LABEL: Record<RevealFulfilmentOutcome, string> = {
    [RevealFulfilmentOutcome.Settled]: 'settled',
    [RevealFulfilmentOutcome.AlreadyDone]: 'already settled',
    [RevealFulfilmentOutcome.Busy]: 'left to the call already settling it',
    [RevealFulfilmentOutcome.RetiredSource]: 'skipped, retired randomness source',
    [RevealFulfilmentOutcome.NotReady]: 'still open',
    [RevealFulfilmentOutcome.Failed]: 'failed',
};

function countOf(report: RevealFulfilmentReport, outcome: RevealFulfilmentOutcome): number {
    return report.requests.filter((entry) => entry.outcome === outcome).length;
}

function entryLine(entry: RevealFulfilmentEntry): string {
    const cell = entry.tokenId === null ? '' : ` (cell ${entry.tokenId})`;
    const tx = entry.fulfillTxHash === null ? '' : ` Fulfil tx ${entry.fulfillTxHash}.`;
    return `Request ${entry.requestId}${cell}: ${OUTCOME_LABEL[entry.outcome]} — ${entry.note}${tx}`;
}

function emptyLine(tokenIds: Array<string> | null): string {
    if (tokenIds !== null && tokenIds.length > 0) {
        return (
            `None of the cells you named (${tokenIds.join(', ')}) has an open reveal request the game API ` +
            `lists, so nothing was settled.`
        );
    }
    return 'You have no open reveal request the game API lists, so nothing was settled.';
}

function summaryLine(report: RevealFulfilmentReport): string {
    const settled = countOf(report, RevealFulfilmentOutcome.Settled);
    const done = countOf(report, RevealFulfilmentOutcome.AlreadyDone);
    const left = report.requests.length - settled - done;
    const already = done > 0 ? `, ${done} already carried the draw` : '';
    const open = left > 0 ? `, ${left} still open` : '';
    return (
        `Settled ${settled} of ${report.requests.length} reveal requests at randomness source ` +
        `${report.source}${already}${open}.`
    );
}

function settledAnyRequest(report: RevealFulfilmentReport): boolean {
    return report.requests.some((entry) => entry.fulfillTxHash !== null);
}

export function registerFulfillRevealTool(server: ToolRegistrar, context: AppContext): void {
    server.registerTool(
        'cpu_fulfill_reveal',
        { description: FULFILL_REVEAL_DESCRIPTION, inputSchema: fulfillRevealInputSchema },
        async (args: FulfillRevealInput) => {
            const report = await context.revealFulfilment.fulfill(args);
            const header =
                report.requests.length === 0
                    ? emptyLine(args.tokenIds)
                    : [summaryLine(report), ...report.requests.map(entryLine)].join(' ');

            return {
                content: [
                    { type: 'text', text: header },
                    {
                        type: 'text',
                        text: JSON.stringify({
                            ...report,
                            ...(settledAnyRequest(report) ? { eventType: ToolEventType.RevealFulfilled } : {}),
                        }),
                    },
                ],
            };
        },
    );
}
