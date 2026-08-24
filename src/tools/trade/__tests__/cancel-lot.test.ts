import { describe, expect, it } from 'vitest';

import { cancelResult, capture } from './fixtures.js';
import { ToolEventType } from '../../types.js';
import { registerCancelLotTool } from '../cancel-lot/cancel-lot.js';

describe('cancel_lot tool', () => {
    it('summarizes a cancel with the returned units and finalize hint', async () => {
        const handler = capture(registerCancelLotTool, { trade: { cancelLot: async () => cancelResult } });
        const result = await handler({ lotId: '7', chain: [] } as never);
        expect(result.content[0]?.text).toMatch(/Cancelled lot 7/);
        expect(result.content[0]?.text).toMatch(/finalize_delivery on 123/);
        expect(result.content[0]?.text).toMatch(/cancel tx 0xcancel/);
    });

    it('names the event in the machine block', async () => {
        const handler = capture(registerCancelLotTool, { trade: { cancelLot: async () => cancelResult } });
        const cancelled = await handler({ lotId: '7', chain: [] } as never);
        expect((JSON.parse(cancelled.content[1]?.text ?? '{}') as { eventType: string }).eventType).toBe(
            ToolEventType.LotCancelled,
        );
    });
});
