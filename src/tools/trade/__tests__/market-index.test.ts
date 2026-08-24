import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { capture, captureTool, marketIndex } from './fixtures.js';
import type { MarketIndex } from '../../../api/types.js';
import { registerGetMarketIndexTool } from '../market-index/market-index.js';

describe('get_market_index tool', () => {
    it('summarizes each resource with price, 24h change, and volume', async () => {
        const handler = capture(registerGetMarketIndexTool, { trade: { getMarketIndex: async () => marketIndex } });
        const result = await handler({} as never);
        expect(result.content[0]?.text).toMatch(/Silica \(#3\): 0\.5 \$CPU\/u/);
        expect(result.content[0]?.text).toMatch(/\+3\.2% 24h/);
        expect(result.content[0]?.text).toMatch(/120 units traded 24h/);
    });

    it('states the staleness, no-trades-is-not-zero and units-not-money warnings in the text', async () => {
        const handler = capture(registerGetMarketIndexTool, { trade: { getMarketIndex: async () => marketIndex } });
        const result = await handler({} as never);
        expect(result.content[0]?.text).toMatch(/hour/i);
        expect(result.content[0]?.text).toMatch(/never as a price of 0/i);
        expect(result.content[0]?.text).toMatch(/units.*not \$CPU/i);
    });

    it('states the same three warnings in the tool description an agent reads before calling', () => {
        const { description } = captureTool(registerGetMarketIndexTool, {
            trade: { getMarketIndex: async () => marketIndex },
        });
        expect(description).toMatch(/up to an hour behind/i);
        expect(description).toMatch(/never as free or as zero/i);
        expect(description).toMatch(/units.*not \$CPU/i);
    });

    it('registers under the public tool name agents call', () => {
        const { name } = captureTool(registerGetMarketIndexTool, {
            trade: { getMarketIndex: async () => marketIndex },
        });
        expect(name).toBe('cpu_get_market_index');
    });

    it('takes no required inputs — callable with an empty argument object', () => {
        const { inputSchema } = captureTool(registerGetMarketIndexTool, {
            trade: { getMarketIndex: async () => marketIndex },
        });
        expect(z.object(inputSchema).safeParse({}).success).toBe(true);
    });

    it('prints a resource with no trades in words, never as a price', async () => {
        const handler = capture(registerGetMarketIndexTool, { trade: { getMarketIndex: async () => marketIndex } });
        const result = await handler({} as never);
        const lines = result.content[0]?.text.split('\n') ?? [];
        const noTradeLine = lines.find((line) => line.includes('resource #6'));
        expect(noTradeLine).toMatch(/no trades/i);
        expect(noTradeLine).not.toMatch(/\$CPU\/u/);
    });

    it('leaves the spark series out of the text summary but keeps it in the JSON block', async () => {
        const handler = capture(registerGetMarketIndexTool, { trade: { getMarketIndex: async () => marketIndex } });
        const result = await handler({} as never);
        expect(result.content[0]?.text).not.toMatch(/spark/i);
        expect(result.content[0]?.text.includes('0.77')).toBe(false);
        expect(result.content[0]?.text.includes('0.88')).toBe(false);
        const json = JSON.parse(result.content[1]?.text ?? '{}') as MarketIndex;
        expect(json.resources[0]?.spark).toEqual(['0.77', '0.88']);
    });

    it('prints the exact fractional price, change, and volume strings the service returned, unrounded', async () => {
        const oddIndex: MarketIndex = {
            computedAt: 1700000000,
            resources: [
                {
                    resourceId: 3,
                    priceCpu: '0.123456789012345678',
                    changePct: -1.5,
                    volume: '999999999999999999',
                    spark: [],
                },
            ],
        };
        const handler = capture(registerGetMarketIndexTool, { trade: { getMarketIndex: async () => oddIndex } });
        const result = await handler({} as never);
        expect(result.content[0]?.text.includes('0.123456789012345678')).toBe(true);
        expect(result.content[0]?.text.includes('-1.5% 24h')).toBe(true);
        expect(result.content[0]?.text.includes('999999999999999999 units traded 24h')).toBe(true);
        const json = JSON.parse(result.content[1]?.text ?? '{}') as MarketIndex;
        expect(json.resources[0]?.priceCpu).toBe('0.123456789012345678');
        expect(json.resources[0]?.volume).toBe('999999999999999999');
    });

    it('does not pin the resource count — every row the service returned renders', async () => {
        const wideIndex: MarketIndex = {
            computedAt: 1700000000,
            resources: [
                { resourceId: 1, priceCpu: '1', changePct: 0, volume: '1', spark: [] },
                { resourceId: 2, priceCpu: '2', changePct: 0, volume: '2', spark: [] },
                { resourceId: 3, priceCpu: '3', changePct: 0, volume: '3', spark: [] },
            ],
        };
        const handler = capture(registerGetMarketIndexTool, { trade: { getMarketIndex: async () => wideIndex } });
        const result = await handler({} as never);
        const json = JSON.parse(result.content[1]?.text ?? '{}') as MarketIndex;
        expect(json.resources).toHaveLength(3);
        expect(result.content[0]?.text.match(/\$CPU\/u/g)).toHaveLength(3);
    });

    it('renders every row and every spark point when the world grows past its current size', async () => {
        const spark = Array.from({ length: 90 }, (_, i) => `0.${i}`);
        const grownIndex: MarketIndex = {
            computedAt: 1700000000,
            resources: Array.from({ length: 40 }, (_, i) => ({
                resourceId: i + 1,
                priceCpu: `${i + 1}`,
                changePct: 0,
                volume: `${i + 1}`,
                spark,
            })),
        };
        const handler = capture(registerGetMarketIndexTool, { trade: { getMarketIndex: async () => grownIndex } });
        const result = await handler({} as never);
        expect(result.content[0]?.text.match(/\$CPU\/u/g)).toHaveLength(grownIndex.resources.length);
        const json = JSON.parse(result.content[1]?.text ?? '{}') as MarketIndex;
        expect(json.resources).toHaveLength(grownIndex.resources.length);
        expect(json.resources.map((row) => row.resourceId)).toEqual(grownIndex.resources.map((row) => row.resourceId));
        expect(json.resources[0]?.spark).toHaveLength(spark.length);
        expect(json.resources[0]?.spark).toEqual(spark);
        expect(json.resources.at(-1)?.spark).toEqual(spark);
    });
});
