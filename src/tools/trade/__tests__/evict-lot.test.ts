import { describe, expect, it } from 'vitest';

import { capture, captureTool } from './fixtures.js';
import { LotState } from '../../../api/types.js';
import type { EvictLotInput, EvictLotResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { TxStatus } from '../../../wallet/types.js';
import { ToolEventType, type ToolRegistrar } from '../../types.js';
import { registerEvictLotTool } from '../evict-lot/evict-lot.js';

const evictResult: EvictLotResult = {
    lotId: '7',
    hubTokenId: '20',
    sellerAddress: '0x1111111111111111111111111111111111111111',
    resourceId: 3,
    remaining: '80',
    state: LotState.Evicted,
    txHash: '0xevict',
    status: TxStatus.Success,
    blockNumber: '100',
};

function withService(result: EvictLotResult | Error = evictResult): {
    register: (server: ToolRegistrar, context: AppContext) => void;
    calls: Array<EvictLotInput>;
} {
    const calls: Array<EvictLotInput> = [];
    const eviction = {
        async evictLot(input: EvictLotInput): Promise<EvictLotResult> {
            calls.push(input);
            if (result instanceof Error) {
                throw result;
            }
            return result;
        },
    };
    return {
        register: (server, context) => registerEvictLotTool(server, context, eviction),
        calls,
    };
}

describe('evict_lot tool', () => {
    it('registers cpu_evict_lot', () => {
        const tool = captureTool(withService().register, {});
        expect(tool.name).toBe('cpu_evict_lot');
    });

    it('accepts exactly one lot id and nothing else', () => {
        const tool = captureTool(withService().register, {});
        expect(Object.keys(tool.inputSchema)).toEqual(['lotId']);
    });

    it('describes itself as the hub owner’s action on someone else’s lot', () => {
        const tool = captureTool(withService().register, {});
        expect(tool.description).toMatch(/hub/i);
        expect(tool.description).toMatch(/session/i);
        expect(tool.description).toMatch(/no goods move|moves no goods/i);
    });

    it('passes the lot id straight through to the eviction', async () => {
        const { register, calls } = withService();
        const handler = capture(register, {});

        await handler({ lotId: '7' } as never);

        expect(calls).toEqual([{ lotId: '7' }]);
    });

    it('reports the lot, hub, seller, resource, remainder, evicted state and the transaction', async () => {
        const handler = capture(withService().register, {});

        const result = await handler({ lotId: '7' } as never);
        const text = result.content[0]?.text ?? '';

        expect(text).toMatch(/lot 7/i);
        expect(text).toMatch(/Hub 20/);
        expect(text).toMatch(/0x1111111111111111111111111111111111111111/);
        expect(text).toMatch(/Silica/);
        expect(text).toMatch(/80/);
        expect(text).toMatch(/evicted/i);
        expect(text).toMatch(/0xevict/);
        expect(text).toMatch(/block 100/);
    });

    it('says outright that no goods moved and that nothing was seized', async () => {
        const handler = capture(withService().register, {});

        const text = (await handler({ lotId: '7' } as never)).content[0]?.text ?? '';

        expect(text).toMatch(/no goods moved/i);
        expect(text).toMatch(/still (the seller|theirs)|still belong/i);
    });

    it('says the seller stays blocked from listing here until they return the lot', async () => {
        const handler = capture(withService().register, {});

        const text = (await handler({ lotId: '7' } as never)).content[0]?.text ?? '';

        expect(text).toMatch(/cannot list|blocked from listing/i);
        expect(text).toMatch(/until/i);
        expect(text).not.toMatch(/the lot is gone|no longer exists/i);
    });

    it('names the eviction event in the machine block and carries the whole result', async () => {
        const handler = capture(withService().register, {});

        const machine = JSON.parse((await handler({ lotId: '7' } as never)).content[1]?.text ?? '{}') as Record<
            string,
            unknown
        >;

        expect(machine.eventType).toBe(ToolEventType.LotEvicted);
        expect(machine).toMatchObject({ ...evictResult });
    });

    it('lets a refusal reach the tool boundary unrewritten, so the domain error is what the agent reads', async () => {
        const handler = capture(withService(new Error('Lot 7 is your own lot')).register, {});

        await expect(handler({ lotId: '7' } as never)).rejects.toThrow(/your own lot/);
    });
});
