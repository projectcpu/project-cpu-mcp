import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../../logger/noop.logger.js';
import type { RevealResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { TxStatus } from '../../../wallet/types.js';
import { ToolEventType, type ToolRegistrar } from '../../types.js';
import { registerRevealTool } from '../reveal.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Handler = (args: { tokenId: string }) => Promise<ToolResult>;

function harness(outcome: RevealResult | Error): Handler {
    const reveal = {
        reveal: async (): Promise<RevealResult> => {
            if (outcome instanceof Error) {
                throw outcome;
            }
            return outcome;
        },
    };
    const context = { reveal, logger: new NoopLogger() } as unknown as AppContext;

    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    registerRevealTool(server, context);
    if (captured === null) {
        throw new Error('reveal was not registered');
    }
    return captured;
}

const SOURCE = '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa';

const fulfilledGenesis: RevealResult = {
    tokenId: '42',
    genesis: true,
    requestTxHash: '0xreveal',
    fulfillTxHash: null,
    requestId: null,
    source: SOURCE,
    round: null,
    deposits: null,
    status: TxStatus.Success,
    blockNumber: '100',
    ethPaid: '0.0001',
    cpuBurn: '0',
    approveTxHash: null,
    fulfilled: true,
    note: null,
};

const settledInline: RevealResult = {
    ...fulfilledGenesis,
    fulfillTxHash: '0xfulfil',
    requestId: '7',
    round: '91',
    deposits: [
        { resourceId: 5, resourceName: 'Iron', amount: '100', strength: 3 },
        { resourceId: 6, resourceName: 'Copper', amount: '200', strength: 4 },
    ],
};

const STALE_MAP_NOTE =
    'The reveal is settled on-chain, but refreshing the map right after it failed (map read failed with 503), ' +
    'so get_cell 42 may still show the cell without the new draw until the map catches up.';

const SETTLED_HEAD =
    'Requested reveal for cell 42 — paid 0.0001 ETH and burned 0 $CPU, the price the cell quoted for this ' +
    'reveal. request tx 0xreveal confirmed in block 100. ' +
    `Reveal request 7 at randomness source ${SOURCE}, settled by beacon round 91. fulfil tx 0xfulfil.`;

describe('reveal tool', () => {
    it('reports a fulfilled genesis reveal as paid, without an approve line', async () => {
        const result = await harness(fulfilledGenesis)({ tokenId: '42' });
        expect(result.content[0]?.text).toMatch(/0xreveal/);
        expect(result.content[0]?.text).toMatch(/paid 0\.0001 ETH and burned 0 \$CPU/);
        expect(result.content[0]?.text).toMatch(/revealed/i);
        expect(result.content[0]?.text).not.toMatch(/approve/i);
        const parsed = JSON.parse(result.content[1]?.text ?? '{}') as RevealResult;
        expect(parsed.requestTxHash).toBe('0xreveal');
        expect(parsed.approveTxHash).toBeNull();
    });

    it('never calls a reveal free, whichever reveal of the cell it is', async () => {
        for (const genesis of [true, false]) {
            const text = (await harness({ ...fulfilledGenesis, genesis })({ tokenId: '42' })).content[0]?.text ?? '';
            expect(text).not.toMatch(/free/i);
        }
    });

    it('charges a first reveal and a later reveal the same way in the line it prints', async () => {
        const first = (await harness({ ...fulfilledGenesis, cpuBurn: '1' })({ tokenId: '42' })).content[0]?.text;
        const later = (await harness({ ...fulfilledGenesis, genesis: false, cpuBurn: '1' })({ tokenId: '42' }))
            .content[0]?.text;

        expect(first).toBe(later);
        expect(first).toMatch(/paid 0\.0001 ETH and burned 1 \$CPU/);
    });

    it('reports the approve tx and the burn when the reveal approved $CPU', async () => {
        const result = await harness({
            ...fulfilledGenesis,
            genesis: false,
            approveTxHash: '0xapprove',
            cpuBurn: '1',
        })({ tokenId: '42' });
        expect(result.content[0]?.text).toMatch(/approve tx 0xapprove/);
        expect(result.content[0]?.text).toMatch(/burned 1 \$CPU/);
    });

    it('tells the agent to poll get_cell when a pushed draw is still pending', async () => {
        const result = await harness({ ...fulfilledGenesis, fulfilled: false })({ tokenId: '42' });
        expect(result.content[0]?.text).toMatch(/poll get_cell/);
        expect(result.content[0]?.text).toMatch(/not ready yet/i);
    });

    it('names the deposits the reveal drew, with the request, the round and both transactions', async () => {
        const result = await harness(settledInline)({ tokenId: '42' });
        const text = result.content[0]?.text ?? '';
        expect(text).toMatch(/request tx 0xreveal/);
        expect(text).toMatch(/Reveal request 7 at randomness source/);
        expect(text).toMatch(/beacon round 91/);
        expect(text).toMatch(/fulfil tx 0xfulfil/);
        expect(text).toMatch(/100 Iron \(#5\) at strength 3/);
        expect(text).toMatch(/200 Copper \(#6\) at strength 4/);
    });

    it('says plainly when the draw landed and rolled nothing', async () => {
        const result = await harness({ ...settledInline, deposits: [] })({ tokenId: '42' });
        expect(result.content[0]?.text).toMatch(/rolled nothing on cell 42/i);
        expect(result.content[0]?.text).not.toMatch(/strength/i);
    });

    it('falls back to get_cell when the reveal landed but this call never saw the draw', async () => {
        const result = await harness({ ...settledInline, deposits: null, fulfillTxHash: null })({ tokenId: '42' });
        expect(result.content[0]?.text).toMatch(/read them with get_cell 42/);
    });

    it('says the map is behind next to the draw this call already read', async () => {
        const result = await harness({ ...settledInline, note: STALE_MAP_NOTE })({ tokenId: '42' });

        expect(result.content[0]?.text).toBe(
            `${SETTLED_HEAD} ${STALE_MAP_NOTE} ` +
                'Deposits are revealed — cell 42 drew 100 Iron (#5) at strength 3, 200 Copper (#6) at strength 4.',
        );
    });

    it('sends the agent to the map only once it has caught up when the note says it is behind', async () => {
        const result = await harness({ ...settledInline, deposits: null, note: STALE_MAP_NOTE })({ tokenId: '42' });

        expect(result.content[0]?.text).toBe(
            `${SETTLED_HEAD} ${STALE_MAP_NOTE} Read the draw with get_cell 42 once the map has caught up.`,
        );
        expect(result.content[0]?.text).not.toMatch(/read them with get_cell 42\./);
    });

    it('passes the service note through when the cycle stopped after the request', async () => {
        const result = await harness({
            ...settledInline,
            fulfilled: false,
            fulfillTxHash: null,
            deposits: null,
            note: 'Round 91 was still unpublished. Call reveal on cell 42 again to settle it.',
        })({ tokenId: '42' });
        expect(result.content[0]?.text).toMatch(/Round 91 was still unpublished/);
        expect(result.content[0]?.text).toMatch(/call reveal on cell 42 again/i);
    });

    it('explains a pending reveal the game API does not list yet, naming both ways out', async () => {
        const result = await harness({
            ...fulfilledGenesis,
            requestTxHash: null,
            status: null,
            blockNumber: null,
            ethPaid: '0',
            fulfilled: false,
            note:
                'Cell 42 already carries a reveal request, but the game API does not list that request yet. ' +
                'Two ways out: call reveal on cell 42 again in a few seconds; or read the draw with get_cell 42.',
        })({ tokenId: '42' });
        const text = result.content[0]?.text ?? '';
        expect(text).toMatch(/already carried a reveal request/i);
        expect(text).toMatch(/nothing was spent/i);
        expect(text).toMatch(/does not list that request yet/i);
        expect(text).toMatch(/call reveal on cell 42 again/i);
        expect(text).toMatch(/get_cell 42/);
        expect(text).not.toMatch(/confirmed in block/);
    });

    it('tags the machine block with the reveal event and keeps the service result intact', async () => {
        const result = await harness(settledInline)({ tokenId: '42' });

        expect(result.content[1]?.text).toBe(
            JSON.stringify({ ...settledInline, eventType: ToolEventType.CellRevealed }),
        );
        expect(result.content).toHaveLength(2);
    });

    it('names the same event whether or not the draw landed while the call watched', async () => {
        const settled = await harness(settledInline)({ tokenId: '42' });
        const pending = await harness({ ...settledInline, fulfilled: false })({ tokenId: '42' });

        const eventOf = (text: string): string => (JSON.parse(text) as { eventType: string }).eventType;
        expect(eventOf(settled.content[1]?.text ?? '{}')).toBe(ToolEventType.CellRevealed);
        expect(eventOf(pending.content[1]?.text ?? '{}')).toBe(ToolEventType.CellRevealed);
    });

    it('propagates service errors', async () => {
        await expect(harness(new Error('not authenticated'))({ tokenId: '42' })).rejects.toThrow(/not authenticated/);
    });
});
