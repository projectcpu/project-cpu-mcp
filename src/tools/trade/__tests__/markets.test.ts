import { describe, expect, it } from 'vitest';

import { capture, hubCell, market } from './fixtures.js';
import { type MarketResourceSummary, BuildingType } from '../../../api/types.js';
import { registerGetMarketsTool } from '../markets/get-markets.js';

describe('get_markets tool', () => {
    it('enriches the live sale fee from an active hub with an override', async () => {
        const handler = capture(registerGetMarketsTool, {
            trade: { getMarkets: async () => [market] },
            mapReader: { readRevealCell: async (id: string) => (id === '5' ? hubCell({ 3: 2.5 }) : null) },
        });
        const result = await handler({} as never);
        expect(result.content[0]?.text).toMatch(/Hub 5 · /);
        expect(result.content[0]?.text).toMatch(/2 open/);
        expect(result.content[0]?.text).toMatch(/from 0.4 \$CPU/);
        expect(result.content[0]?.text).toMatch(/sale fee 2.5%/);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<{ liveSaleFeePercent: number | null }>;
        expect(json[0]?.liveSaleFeePercent).toBe(2.5);
    });

    it('reports an active hub with no override as 0%', async () => {
        const handler = capture(registerGetMarketsTool, {
            trade: { getMarkets: async () => [market] },
            mapReader: { readRevealCell: async () => hubCell({}) },
        });
        const result = await handler({} as never);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<{ liveSaleFeePercent: number | null }>;
        expect(json[0]?.liveSaleFeePercent).toBe(0);
    });

    it('reports null for a hub still under construction, even with an override set', async () => {
        const handler = capture(registerGetMarketsTool, {
            trade: { getMarkets: async () => [market] },
            mapReader: {
                readRevealCell: async () =>
                    hubCell(
                        { 3: 2.5 },
                        { type: BuildingType.Hub, buildFinishAt: 100, modeResource: null, modeRecipeId: null },
                    ),
            },
        });
        const result = await handler({} as never);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<{ liveSaleFeePercent: number | null }>;
        expect(json[0]?.liveSaleFeePercent).toBeNull();
    });

    it('reports null for a cell with no hub-kind building at all', async () => {
        const handler = capture(registerGetMarketsTool, {
            trade: { getMarkets: async () => [market] },
            mapReader: { readRevealCell: async () => hubCell(null, null) },
        });
        const result = await handler({} as never);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<{ liveSaleFeePercent: number | null }>;
        expect(json[0]?.liveSaleFeePercent).toBeNull();
    });

    it('degrades liveSaleFeePercent to null when the map has no read on the hub', async () => {
        const handler = capture(registerGetMarketsTool, {
            trade: { getMarkets: async () => [market] },
            mapReader: { readRevealCell: async () => null },
        });
        const result = await handler({} as never);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<{ liveSaleFeePercent: number | null }>;
        expect(json[0]?.liveSaleFeePercent).toBeNull();
    });

    it('prints the exact minPrice string the service returned, unrounded', async () => {
        const oddPricedMarket: MarketResourceSummary = { ...market, minPricePerUnit: '0.123456789012345678' };
        const handler = capture(registerGetMarketsTool, {
            trade: { getMarkets: async () => [oddPricedMarket] },
            mapReader: { readRevealCell: async () => null },
        });
        const result = await handler({} as never);
        expect(result.content[0]?.text.includes('0.123456789012345678')).toBe(true);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<{ minPricePerUnit: string | null }>;
        expect(json[0]?.minPricePerUnit).toBe('0.123456789012345678');
    });

    it('surfaces the frozen aggregate when the server serves it', async () => {
        const frozenMarket: MarketResourceSummary = { ...market, frozenLots: 1, frozenRemaining: '40' };
        const handler = capture(registerGetMarketsTool, {
            trade: { getMarkets: async () => [frozenMarket] },
            mapReader: { readRevealCell: async () => hubCell({ 3: 2.5 }) },
        });
        const result = await handler({} as never);
        expect(result.content[0]?.text).toMatch(/1 frozen \(40\)/);
    });
});
