import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { capture, captureTool, evictedLot, frozenLot, lot } from './fixtures.js';
import { type LotView, LotState } from '../../../api/types.js';
import { registerListMyLotsTool } from '../list-mine/list-my-lots.js';
import { listMyLotsInputSchema } from '../types.js';

describe('list_my_lots tool', () => {
    it('shows the count and state filter', async () => {
        const handler = capture(registerListMyLotsTool, { trade: { listMyLots: async () => [lot] } });
        const result = await handler({ state: LotState.Open } as never);
        expect(result.content[0]?.text).toMatch(/1 lot\(s\) · state=open/);
    });

    it('marks a frozen lot', async () => {
        const handler = capture(registerListMyLotsTool, { trade: { listMyLots: async () => [frozenLot] } });
        const result = await handler({ state: null } as never);
        expect(result.content[0]?.text).toMatch(/FROZEN/);
    });
});

describe('list_my_lots tool — evicted lots', () => {
    it('asks the service for every state when no filter is given, so an evicted lot is listed by default', async () => {
        const seen: Array<LotState | null> = [];
        const handler = capture(registerListMyLotsTool, {
            trade: {
                listMyLots: async (state: LotState | null) => {
                    seen.push(state);
                    return [lot, evictedLot];
                },
            },
        });

        const result = await handler({ state: null } as never);

        expect(seen).toEqual([null]);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<LotView>;
        expect(json.map((row) => row.state)).toEqual([LotState.Open, LotState.Evicted]);
    });

    it('marks the evicted row in the summary so it cannot be read as an active offer', async () => {
        const handler = capture(registerListMyLotsTool, { trade: { listMyLots: async () => [evictedLot] } });
        const result = await handler({ state: null } as never);
        expect(result.content[0]?.text).toMatch(/lot lot-evicted \[evicted\] · .*EVICTED — not for sale/);
    });

    it('accepts evicted as an explicit filter and passes it to the service untouched', async () => {
        const seen: Array<LotState | null> = [];
        const handler = capture(registerListMyLotsTool, {
            trade: {
                listMyLots: async (state: LotState | null) => {
                    seen.push(state);
                    return [evictedLot];
                },
            },
        });

        const result = await handler({ state: LotState.Evicted } as never);

        expect(seen).toEqual([LotState.Evicted]);
        expect(result.content[0]?.text).toMatch(/1 lot\(s\) · state=evicted/);
    });

    it('admits evicted in its input schema, alongside every other lifecycle value', () => {
        const schema = z.object({ state: listMyLotsInputSchema.state });
        for (const state of Object.values(LotState)) {
            expect(schema.safeParse({ state }).success).toBe(true);
        }
        expect(schema.safeParse({ state: 'reclaimed' }).success).toBe(false);
    });

    it('tells the agent that evicted lots are included and can be isolated', () => {
        const { description } = captureTool(registerListMyLotsTool, { trade: { listMyLots: async () => [] } });
        expect(description).toMatch(/state=evicted/);
        expect(description).toMatch(/included by default/);
    });
});
