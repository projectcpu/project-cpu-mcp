import {
    decodeEventLog,
    encodeAbiParameters,
    encodeEventTopics,
    encodeFunctionData,
    type Address,
    type Hex,
} from 'viem';
import { describe, expect, it } from 'vitest';

import { CELL_ABI } from '../cell.abi.js';

const SOURCE = '0x00000000000000000000000000000000000000A1' as Address;

function topicsOf(topics: unknown): [Hex, ...Array<Hex>] {
    return topics as [Hex, ...Array<Hex>];
}

describe('CELL_ABI reveal surface', () => {
    it('decodes a reveal request keyed by the indexed cell and source', () => {
        const topics = encodeEventTopics({
            abi: CELL_ABI,
            eventName: 'RevealRequested',
            args: { tokenId: 42n, source: SOURCE },
        });
        const data = encodeAbiParameters(
            [{ type: 'uint64' }, { type: 'bool' }, { type: 'uint32' }, { type: 'uint64' }],
            [7n, true, 1, 1_700_000_000n],
        );

        const decoded = decodeEventLog({ abi: CELL_ABI, topics: topicsOf(topics), data });

        expect(decoded.eventName).toBe('RevealRequested');
        expect(decoded.args).toEqual({
            tokenId: 42n,
            source: SOURCE,
            requestId: 7n,
            isGenesis: true,
            revealCount: 1,
            requestedAt: 1_700_000_000n,
        });
    });

    it('decodes a fulfilment carrying the drawn deposits as three parallel slots', () => {
        const topics = encodeEventTopics({
            abi: CELL_ABI,
            eventName: 'RevealFulfilled',
            args: { tokenId: 42n, source: SOURCE },
        });
        const data = encodeAbiParameters(
            [
                { type: 'uint64' },
                { type: 'uint32' },
                { type: 'uint16[3]' },
                { type: 'uint64[3]' },
                { type: 'uint8[3]' },
            ],
            [7n, 1, [5, 6, 0], [100n, 200n, 0n], [3, 4, 0]],
        );

        const decoded = decodeEventLog({ abi: CELL_ABI, topics: topicsOf(topics), data });

        expect(decoded.eventName).toBe('RevealFulfilled');
        expect(decoded.args).toEqual({
            tokenId: 42n,
            source: SOURCE,
            requestId: 7n,
            revealCount: 1,
            resources: [5, 6, 0],
            amounts: [100n, 200n, 0n],
            strengths: [3, 4, 0],
        });
    });

    it('knows the randomness source view and no longer names a provider of its own', () => {
        expect(encodeFunctionData({ abi: CELL_ABI, functionName: 'randomnessSource', args: [] })).toMatch(
            /^0x[0-9a-f]{8}$/,
        );

        const names = CELL_ABI.map((entry) => entry.name);
        expect(names).not.toContain('entropy');
        expect(names).not.toContain('entropyProvider');
    });
});
