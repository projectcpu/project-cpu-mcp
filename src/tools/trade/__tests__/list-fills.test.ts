import { describe, expect, it } from 'vitest';

import { capture, fill } from './fixtures.js';
import type { FillView } from '../../../api/types.js';
import type { ListFillsQuery } from '../../../services/types.js';
import { registerListFillsTool } from '../list-fills/list-fills.js';

describe('list_fills tool', () => {
    it('hands every input to the service untouched — the cursor above all', async () => {
        const seen: Array<ListFillsQuery> = [];
        const handler = capture(registerListFillsTool, {
            trade: {
                listFills: async (query: ListFillsQuery) => {
                    seen.push(query);
                    return [fill];
                },
            },
        });

        await handler({ resourceId: 3, hubTokenId: 20, before: '1200:4', limit: 25 } as never);

        expect(seen).toHaveLength(1);
        expect(seen[0]).toEqual({ resourceId: 3, hubTokenId: 20, before: '1200:4', limit: 25 });
    });

    it('names the resource and prints the settle time in human form', async () => {
        const handler = capture(registerListFillsTool, { trade: { listFills: async () => [fill] } });
        const result = await handler({} as never);
        expect(result.content[0]?.text).toMatch(/1 fill/);
        expect(result.content[0]?.text).toMatch(/Silica \(#3\)/);
        expect(result.content[0]?.text).toMatch(/2023-11-14 22:13:20 UTC/);
    });

    it('flags a fill that bought out the lot and leaves a partial one unflagged', async () => {
        const handler = capture(registerListFillsTool, {
            trade: { listFills: async () => [{ ...fill, remaining: '0', soldOut: true }, fill] },
        });
        const result = await handler({} as never);
        const [soldOutLine, partialLine] = (result.content[0]?.text ?? '').split('\n').slice(1);
        expect(soldOutLine).toMatch(/SOLD OUT/);
        expect(partialLine).not.toMatch(/SOLD OUT/);
    });

    it('prints the exact money strings the service returned, unrounded', async () => {
        const oddFill: FillView = {
            ...fill,
            sale: '0.123456789012345678',
            pricePerUnit: '0.012345678901234567',
            hubFee: '0.003456789012345671',
            burn: '0.000456789012345672',
        };
        const handler = capture(registerListFillsTool, { trade: { listFills: async () => [oddFill] } });
        const result = await handler({} as never);
        const text = result.content[0]?.text ?? '';
        expect(text.includes('0.123456789012345678')).toBe(true);
        expect(text.includes('0.012345678901234567')).toBe(true);
        expect(text.includes('hub fee 0.003456789012345671')).toBe(true);
        expect(text.includes('burned 0.000456789012345672')).toBe(true);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<FillView>;
        expect(json[0]?.sale).toBe('0.123456789012345678');
        expect(json[0]?.pricePerUnit).toBe('0.012345678901234567');
        expect(json[0]?.hubFee).toBe('0.003456789012345671');
        expect(json[0]?.burn).toBe('0.000456789012345672');
    });

    it('carries the full field set in the JSON block', async () => {
        const handler = capture(registerListFillsTool, { trade: { listFills: async () => [fill] } });
        const result = await handler({} as never);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<FillView>;
        expect(json[0]).toEqual(fill);
    });

    it('keeps the rows in the order the service returned them', async () => {
        const rows: Array<FillView> = [
            { ...fill, blockNumber: 1200, logIndex: 4 },
            { ...fill, blockNumber: 1199, logIndex: 9 },
            { ...fill, blockNumber: 1100, logIndex: 0 },
        ];
        const handler = capture(registerListFillsTool, { trade: { listFills: async () => rows } });
        const result = await handler({} as never);
        const cursors = (result.content[0]?.text ?? '').split('\n').slice(1);
        expect(cursors.map((line) => line.split(' ')[1])).toEqual(['1200:4', '1199:9', '1100:0']);
        const json = JSON.parse(result.content[1]?.text ?? '[]') as Array<FillView>;
        expect(json.map((row) => `${row.blockNumber}:${row.logIndex}`)).toEqual(['1200:4', '1199:9', '1100:0']);
    });

    it('says so plainly when the page is empty', async () => {
        const handler = capture(registerListFillsTool, { trade: { listFills: async () => [] } });
        const result = await handler({} as never);
        expect(result.content[0]?.text).toMatch(/0 fill\(s\)/);
        expect(result.content[1]?.text).toBe('[]');
    });
});
