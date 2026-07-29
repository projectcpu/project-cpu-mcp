import { describe, expect, it } from 'vitest';

import { NoopLogger } from '../../../logger/noop.logger.js';
import type { EnrichedCell, MapChanges } from '../../../map/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerGetChangesTool } from '../get-changes/get-changes.js';

interface ToolResult {
    content: Array<{ type: string; text: string }>;
}

type Handler = (args: unknown) => Promise<ToolResult>;

const CHANGED: EnrichedCell = {
    tokenId: '9',
    pos: { face: 0, i: 0, j: 9 },
    owner: '0xMe',
    revealCount: 1,
    revealPending: false,
    resources: [{ resourceId: 4, deposit: '50', balance: '0', strength: null, storage: null }],
    building: null,
    demolishFinishAt: null,
    transitFeeOverrides: null,
    saleFeeOverrides: null,
    process: null,
    updated: 5,
    ready: null,
    activeHub: false,
    neighbors: [],
};

function harness(): { handler: Handler; sinceArgs: Array<number> } {
    const sinceArgs: Array<number> = [];
    const map = {
        getChanges(since: number): MapChanges {
            sinceArgs.push(since);
            return { version: 200, serverTime: 1, changed: [CHANGED], changedCount: 1 };
        },
    };
    const wallet = { isReady: () => true, get: () => ({ getAddress: () => '0xMe' }) };
    const appConfig = {
        load: async (): Promise<{ resources: Record<number, string> }> => ({ resources: { 4: 'Iron Ore' } }),
    };
    const api = { getServerHealth: () => ({ reachable: true, reason: null }) };
    const context = { mapReader: map, wallet, appConfig, api, logger: new NoopLogger() } as unknown as AppContext;

    let captured: Handler | null = null;
    const server = {
        registerTool(_name: string, _def: unknown, handler: Handler): void {
            captured = handler;
        },
    } as unknown as ToolRegistrar;

    registerGetChangesTool(server, context);
    if (captured === null) {
        throw new Error('get_changes was not registered');
    }
    return { handler: captured, sinceArgs };
}

describe('get_changes tool', () => {
    it('passes the provided version through', async () => {
        const { handler, sinceArgs } = harness();
        await handler({ sinceVersion: 120 });
        expect(sinceArgs[0]).toBe(120);
    });

    it('defaults a null version to 0 (return everything)', async () => {
        const { handler, sinceArgs } = harness();
        await handler({ sinceVersion: null });
        expect(sinceArgs[0]).toBe(0);
    });

    it('serializes the changes payload, with resource ids labeled from config', async () => {
        const { handler } = harness();
        const result = await handler({ sinceVersion: 0 });
        const parsed = JSON.parse(result.content[1]?.text ?? '{}') as {
            version: number;
            changed: Array<{ resources: Array<{ resourceName: string }> }>;
        };
        expect(parsed.version).toBe(200);
        expect(parsed.changed[0]?.resources[0]?.resourceName).toBe('Iron Ore');
    });

    it('surfaces server reachability in the header and payload', async () => {
        const { handler } = harness();
        const result = await handler({ sinceVersion: 0 });
        expect(result.content[0]?.text).toContain('server=up');
        const parsed = JSON.parse(result.content[1]?.text ?? '{}') as { server: { reachable: boolean } };
        expect(parsed.server.reachable).toBe(true);
    });
});
