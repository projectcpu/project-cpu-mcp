import { describe, expect, it } from 'vitest';

import { BuildingType } from '../../../api/types.js';
import { NoopLogger } from '../../../logger/noop.logger.js';
import { makeCell, makeResource, makeStorage, projectCell } from '../../../map/__tests__/fixtures.js';
import {
    MapReadiness,
    MapScope,
    type EnrichedCell,
    type MapQuery,
    type MapQueryResult,
    type MapSummary,
} from '../../../map/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { GET_MAP_DESCRIPTION } from '../get-map/constants.js';
import { registerGetMapTool } from '../get-map/get-map.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Handler = (args: unknown) => Promise<ToolResult>;

const SUMMARY: MapSummary = {
    version: 5,
    serverTime: 1,
    readiness: MapReadiness.Ready,
    socketConnected: true,
    totalCells: 3,
    myCells: 1,
    myCellsByStatus: { idle: 1, mining: 0, crafting: 0 },
    depletedDeposits: 0,
    stalledCells: 0,
};

function harness(
    walletReady: boolean,
    address: string | null = '0xMe',
    cells: MapQueryResult['cells'] = [],
): { handler: Handler; queries: Array<MapQuery> } {
    const queries: Array<MapQuery> = [];
    const map = {
        query(query: MapQuery): MapQueryResult {
            queries.push(query);
            return {
                summary: SUMMARY,
                scope: query.scope,
                resourceIndex: null,
                cells,
                returnedCells: cells.length,
                note: null,
            };
        },
    };
    const wallet = {
        isReady: () => walletReady,
        get: () => ({ getAddress: () => address ?? '0xMe' }),
    };
    const appConfig = {
        load: async (): Promise<{ resources: Record<number, string> }> => ({ resources: { 3: 'Silica' } }),
    };
    const api = { getServerHealth: () => ({ reachable: true, reason: null }) };
    const context = { mapReader: map, wallet, appConfig, api, logger: new NoopLogger() } as unknown as AppContext;

    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    registerGetMapTool(server, context);
    if (captured === null) {
        throw new Error('get_map was not registered');
    }
    return { handler: captured, queries };
}

const NULL_ARGS = { scope: null, tokenIds: null, aroundTokenId: null, radius: null };

describe('get_map tool', () => {
    it('defaults to scope=mine when the wallet is ready', async () => {
        const { handler, queries } = harness(true, '0xMe');
        await handler(NULL_ARGS);
        expect(queries[0]?.scope).toBe(MapScope.Mine);
        expect(queries[0]?.ownerAddress).toBe('0xMe');
    });

    it('defaults to scope=summary when no wallet is available', async () => {
        const { handler, queries } = harness(false, null);
        await handler(NULL_ARGS);
        expect(queries[0]?.scope).toBe(MapScope.Summary);
        expect(queries[0]?.ownerAddress).toBeNull();
    });

    it('rejects scope=around without a centre', async () => {
        const { handler } = harness(true);
        await expect(handler({ ...NULL_ARGS, scope: MapScope.Around })).rejects.toThrow(/aroundTokenId/i);
    });

    it('rejects scope=cells with no tokenIds', async () => {
        const { handler } = harness(true);
        await expect(handler({ ...NULL_ARGS, scope: MapScope.Cells, tokenIds: [] })).rejects.toThrow(/tokenIds/i);
    });

    it('rejects scope=mine when no wallet is available', async () => {
        const { handler } = harness(false, null);
        await expect(handler({ ...NULL_ARGS, scope: MapScope.Mine })).rejects.toThrow(/wallet/i);
    });

    it('always returns a summary plus the serialized result, with a resource-name legend', async () => {
        const { handler } = harness(true);
        const result = await handler(NULL_ARGS);
        expect(result.content).toHaveLength(2);
        const parsed = JSON.parse(result.content[1]?.text ?? '{}') as MapQueryResult & {
            resourceNames: Record<number, string>;
            server: { reachable: boolean };
        };
        expect(parsed.summary.totalCells).toBe(3);
        expect(parsed.resourceNames).toEqual({ 3: 'Silica' });
        expect(parsed.server.reachable).toBe(true);
    });

    it('reports hub storage held by lots as a reservation, never as a marketplace offer', async () => {
        const hub: EnrichedCell = {
            ...projectCell(
                makeCell({
                    tokenId: '5',
                    building: { type: BuildingType.Hub, buildFinishAt: 0, modeResource: null, modeRecipeId: null },
                    resources: [
                        makeResource({
                            resourceId: 3,
                            storage: makeStorage({ used: '40', reserved: { incomingTransport: '0', lots: '40' } }),
                        }),
                    ],
                }),
            ),
            pos: { face: 0, i: 0, j: 0 },
            neighbors: [],
        };
        const { handler } = harness(true, '0xMe', [hub]);
        const result = await handler(NULL_ARGS);
        const payload = result.content[1]?.text ?? '';
        expect(payload).toMatch(/"lots":"40"/);
        for (const offerField of ['pricePerUnit', 'sellerAddress', 'lotId', 'maxSaleFeeBp', 'remaining']) {
            expect(payload.includes(offerField)).toBe(false);
        }
    });

    it('sends the agent to the trade tools for what is actually buyable', async () => {
        expect(GET_MAP_DESCRIPTION).toMatch(/cpu_list_lots|cpu_get_markets/);
        expect(GET_MAP_DESCRIPTION).toMatch(/offer/i);
    });
});
