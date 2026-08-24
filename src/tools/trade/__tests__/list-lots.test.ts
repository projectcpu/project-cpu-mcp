import { describe, expect, it } from 'vitest';

import { capture, evictedLot, lot } from './fixtures.js';
import { type LotView, LotState } from '../../../api/types.js';
import { registerListLotsTool } from '../list-lots/list-lots.js';

describe('list_lots tool', () => {
    it('renders a lot line with its frozen sale fee', async () => {
        const handler = capture(registerListLotsTool, { trade: { listLots: async () => [lot] } });
        const result = await handler({} as never);
        expect(result.content[0]?.text).toMatch(/1 lot/);
        expect(result.content[0]?.text).toMatch(/lot lot-1 \[open\]/);
        expect(result.content[0]?.text).toMatch(/Silica \(#3\)/);
        expect(result.content[0]?.text).toMatch(/80\/100/);
        expect(result.content[0]?.text).toMatch(/sale fee 1.5%/);
    });

    it('prints the exact price string the service returned, unrounded', async () => {
        const oddPricedLot: LotView = { ...lot, id: 'lot-odd', pricePerUnit: '0.123456789012345678' };
        const handler = capture(registerListLotsTool, { trade: { listLots: async () => [oddPricedLot] } });
        const result = await handler({} as never);
        expect(result.content[0]?.text.includes('0.123456789012345678')).toBe(true);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<LotView>;
        expect(json[0]?.pricePerUnit).toBe('0.123456789012345678');
    });

    it('keeps an evicted lot out of buyer discovery even when a row for one arrives', async () => {
        const handler = capture(registerListLotsTool, {
            trade: { listLots: async () => [lot, evictedLot] },
        });
        const result = await handler({} as never);
        expect(result.content[0]?.text).toMatch(/1 lot/);
        expect(result.content[0]?.text.includes('lot-evicted')).toBe(false);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<LotView>;
        expect(json.map((row) => row.id)).toEqual(['lot-1']);
    });

    it('keeps availability=all meaning open plus delivering, never a terminal or evicted state', async () => {
        const rows: Array<LotView> = [
            { ...lot, id: 'lot-open' },
            { ...lot, id: 'lot-incoming', state: LotState.Delivering },
            { ...lot, id: 'lot-evicted', state: LotState.Evicted },
            { ...lot, id: 'lot-sold', state: LotState.Sold },
            { ...lot, id: 'lot-cancelled', state: LotState.Cancelled },
        ];
        const handler = capture(registerListLotsTool, { trade: { listLots: async () => rows } });
        const result = await handler({ availability: 'all' } as never);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<LotView>;
        expect(json.map((row) => row.id)).toEqual(['lot-open', 'lot-incoming']);
    });
});
