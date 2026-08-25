import { describe, expect, it } from 'vitest';

import { capture, captureTool, evictedLot, frozenLot, lot } from './fixtures.js';
import { type LotView, LotState } from '../../../api/types.js';
import { registerGetLotTool } from '../get-lot/get-lot.js';

describe('get_lot tool', () => {
    it('renders a single lot', async () => {
        const handler = capture(registerGetLotTool, { trade: { getLot: async () => lot } });
        const result = await handler({ lotId: 'lot-1' } as never);
        expect(result.content[0]?.text).toMatch(/lot lot-1 \[open\]/);
    });

    it('annotates and explains a frozen lot, without hiding it', async () => {
        const handler = capture(registerGetLotTool, { trade: { getLot: async () => frozenLot } });
        const result = await handler({ lotId: 'lot-frozen' } as never);
        expect(result.content[0]?.text).toMatch(/lot lot-frozen/);
        expect(result.content[0]?.text).toMatch(/FROZEN \(live 6% > tolerance 5%\)/);
        expect(result.content[0]?.text).toMatch(/exceeds your tolerance/);
        expect(result.content[0]?.text).toMatch(/send the remainder home/);
        const json = JSON.parse(result.content[1]?.text ?? '{}') as LotView;
        expect(json.frozen).toBe(true);
        expect(json.maxSaleFeePercent).toBe(5);
    });

    it('never claims a frozen lot goes home free of every fee', async () => {
        const handler = capture(registerGetLotTool, { trade: { getLot: async () => frozenLot } });
        const result = await handler({ lotId: 'lot-frozen' } as never);
        expect(result.content[0]?.text).not.toMatch(/fee-free/);
        expect(result.content[0]?.text).toMatch(/no sale fee, but the route home still owes transit/);
    });
});

describe('get_lot tool — an evicted lot', () => {
    it('resolves it rather than hiding it', async () => {
        const handler = capture(registerGetLotTool, { trade: { getLot: async () => evictedLot } });
        const result = await handler({ lotId: 'lot-evicted' } as never);
        expect(result.content[0]?.text).toMatch(/lot lot-evicted \[evicted\]/);
        const json = JSON.parse(result.content[1]?.text ?? '{}') as LotView;
        expect(json.state).toBe(LotState.Evicted);
    });

    it('says outright that it cannot be bought and earns nothing', async () => {
        const handler = capture(registerGetLotTool, { trade: { getLot: async () => evictedLot } });
        const text = (await handler({ lotId: 'lot-evicted' } as never)).content[0]?.text ?? '';
        expect(text).toMatch(/EVICTED — not for sale/);
        expect(text).toMatch(/nobody can buy it/);
        expect(text).toMatch(/earns nothing/);
    });

    it('says the units still belong to the seller and still owe a return home', async () => {
        const handler = capture(registerGetLotTool, { trade: { getLot: async () => evictedLot } });
        const text = (await handler({ lotId: 'lot-evicted' } as never)).content[0]?.text ?? '';
        expect(text).toMatch(/units are still yours/);
        expect(text).toMatch(/lot return/i);
        expect(text).toMatch(/whole remainder/);
    });

    it('says it holds no hub storage and blocks new lots on that hub alone', async () => {
        const handler = capture(registerGetLotTool, { trade: { getLot: async () => evictedLot } });
        const text = (await handler({ lotId: 'lot-evicted' } as never)).content[0]?.text ?? '';
        expect(text).toMatch(/no longer occupies hub\s+storage/);
        expect(text).toMatch(/cannot create a\s+new lot on that hub/);
        expect(text).toMatch(/other hubs are unaffected/);
    });

    it('never calls an evicted lot frozen — freezing is a sale-fee state of an open lot', async () => {
        const handler = capture(registerGetLotTool, { trade: { getLot: async () => evictedLot } });
        const result = await handler({ lotId: 'lot-evicted' } as never);
        expect(result.content[0]?.text).not.toMatch(/FROZEN/);
        expect((JSON.parse(result.content[1]?.text ?? '{}') as LotView).frozen).toBe(false);
    });

    it('warns in its description that observing a lot is not the same as being able to buy it', () => {
        const { description } = captureTool(registerGetLotTool, { trade: { getLot: async () => lot } });
        expect(description).toMatch(/evicted/i);
        expect(description).toMatch(/only an `open` lot is buyable/);
    });
});
