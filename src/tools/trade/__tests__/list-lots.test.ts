import { describe, expect, it } from 'vitest';

import { capture, lot } from './fixtures.js';
import type { LotView } from '../../../api/types.js';
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
});
