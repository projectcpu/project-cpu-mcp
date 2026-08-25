import { describe, expect, it, vi } from 'vitest';

import { SERVER_INSTRUCTIONS } from '../server.constants.js';
import { createServer } from '../server.js';
import { PERSONA_TOOL_NAME } from '../tools/persona/constants.js';
import type { AppContext } from '../types.js';

const PUBLIC_TOOLS: ReadonlyArray<string> = [
    'cpu_authenticate',
    'cpu_build',
    'cpu_buy_lot',
    'cpu_claim_craft',
    'cpu_claim_mining',
    'cpu_craft',
    'cpu_create_lot',
    'cpu_create_syndicate',
    'cpu_demolish',
    'cpu_evict_lot',
    'cpu_finalize_delivery',
    'cpu_find_buildings',
    'cpu_fulfill_reveal',
    'cpu_get_attention',
    'cpu_get_balance',
    'cpu_get_building',
    'cpu_get_cell',
    'cpu_get_changes',
    'cpu_get_craft_status',
    'cpu_get_game_config',
    'cpu_get_lot',
    'cpu_get_lot_terms',
    'cpu_get_map',
    'cpu_get_market_index',
    'cpu_get_markets',
    'cpu_get_mining_status',
    'cpu_get_resource',
    'cpu_get_syndicate',
    'cpu_get_syndicate_membership',
    'cpu_get_syndicate_player_content',
    'cpu_get_transport_status',
    'cpu_join_syndicate',
    'cpu_leave_syndicate',
    'cpu_list_fills',
    'cpu_list_lots',
    'cpu_list_my_lots',
    'cpu_list_my_transports',
    'cpu_list_recipes',
    'cpu_list_syndicates',
    'cpu_mint_cell',
    'cpu_next_hops',
    'cpu_quote_buy',
    'cpu_quote_lot_return',
    'cpu_quote_mint',
    'cpu_quote_swap',
    'cpu_quote_transport',
    'cpu_return_lot',
    'cpu_reveal',
    'cpu_route_network',
    'cpu_set_sale_fee',
    'cpu_set_syndicate_params',
    'cpu_start_mining',
    'cpu_swap',
    'cpu_transfer_syndicate_manager',
    'cpu_transport',
    'cpu_upgrade',
    'cpu_withdraw',
];

const RETIRED_TOOLS: ReadonlyArray<string> = ['cpu_cancel_lot'];

/** The three claims about Eviction and Lot return that the shipped surface must never make. */
const EVICTED_LOT_IS_BUYABLE =
    /evicted[^.;]{0,60}?(?:still\s+sells|sells\s+to\s+(?:any|every)|is\s+(?:still\s+)?buyable|can\s+(?:still\s+)?be\s+bought|open\s+to\s+buyers)/iu;
const ONE_RETURN_CLEARS_MANY =
    /(?:one|a\s+single)\s+(?:call|return|lot\s+return)[^.;]{0,60}?clears?\s+(?:every|all|both|several|the\s+rest)/iu;
const RETURN_IS_TRANSIT_FREE =
    /transit[-\s]fee[-\s]free|free\s+of\s+transit|no\s+transit\s+fee|without\s+(?:a\s+|any\s+)?transit\s+fee/iu;

const FORBIDDEN_CLAIMS: ReadonlyArray<[string, RegExp, string]> = [
    [
        'an Evicted lot is buyable',
        EVICTED_LOT_IS_BUYABLE,
        'an Evicted lot still sells to any buyer, and one return clears every Evicted lot you hold',
    ],
    [
        'one return clears several Evicted lots',
        ONE_RETURN_CLEARS_MANY,
        'one call clears every evicted lot you hold at that hub, transit-fee-free',
    ],
    [
        'a Lot return is Transit-fee-free',
        RETURN_IS_TRANSIT_FREE,
        'one call clears every evicted lot you hold at that hub, transit-fee-free',
    ],
];

const sdk = vi.hoisted(() => ({ tools: new Array<{ name: string; description: string }>() }));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
    McpServer: class McpServerStub {
        registerTool(name: string, definition: { description: string }): void {
            sdk.tools.push({ name, description: definition.description });
        }

        connect(): Promise<void> {
            return Promise.resolve();
        }
    },
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: class StdioServerTransportStub {},
}));

async function bootServer(personaEnabled = true): Promise<Array<{ name: string; description: string }>> {
    sdk.tools.length = 0;
    await createServer({ config: { OPERATOR_PERSONA: personaEnabled } } as unknown as AppContext);
    return [...sdk.tools];
}

describe('the registered tool surface', () => {
    it('is exactly the pinned public list plus the operating brief', async () => {
        const tools = await bootServer();

        expect([...tools.map((tool) => tool.name)].sort()).toEqual([...PUBLIC_TOOLS, PERSONA_TOOL_NAME].sort());
    });

    it('registers each name once', async () => {
        const names = (await bootServer()).map((tool) => tool.name);

        expect(names.length).toBe(new Set(names).size);
    });

    it('drops every retired tool', async () => {
        const names = (await bootServer()).map((tool) => tool.name);

        expect(RETIRED_TOOLS).toContain('cpu_cancel_lot');
        expect(names.filter((name) => RETIRED_TOOLS.includes(name))).toEqual([]);
    });

    it('serves the whole Trade lot eviction surface', async () => {
        const names = (await bootServer()).map((tool) => tool.name);

        expect(names).toContain('cpu_get_lot_terms');
        expect(names).toContain('cpu_evict_lot');
        expect(names).toContain('cpu_quote_lot_return');
        expect(names).toContain('cpu_return_lot');
    });

    it('names no unregistered tool in any tool description', async () => {
        const tools = await bootServer();
        const names = tools.map((tool) => tool.name);
        const promised = tools.flatMap((tool) => [...new Set(tool.description.match(/cpu_[a-z_]+/g) ?? [])]);

        expect(promised.length).toBeGreaterThan(0);
        expect([...new Set(promised.filter((name) => !names.includes(name)))]).toEqual([]);
    });

    it('leaves only the operating brief unregistered when the persona is off', async () => {
        const names = (await bootServer(false)).map((tool) => tool.name);

        expect(names.sort()).toEqual([...PUBLIC_TOOLS].sort());
    });
});

describe('the claims the shipped surface must never make', () => {
    it.each(FORBIDDEN_CLAIMS)('is not made by the server instructions: %s', (_claim, pattern) => {
        expect(SERVER_INSTRUCTIONS).not.toMatch(pattern);
    });

    it.each(FORBIDDEN_CLAIMS)('is not made by any tool description: %s', async (_claim, pattern) => {
        const offenders = (await bootServer()).filter((tool) => pattern.test(tool.description));

        expect(offenders.map((tool) => tool.name)).toEqual([]);
    });

    it.each(FORBIDDEN_CLAIMS)('is what the pattern actually catches: %s', (_claim, pattern, sentence) => {
        expect(sentence).toMatch(pattern);
    });
});

describe('a hub that cannot route right now', () => {
    it('is described as temporarily unroutable rather than frozen', async () => {
        const tools = await bootServer();
        const quoteBuy = tools.find((tool) => tool.name === 'cpu_quote_buy')?.description ?? '';

        expect(quoteBuy).toMatch(/temporarily/iu);
        expect(quoteBuy).toMatch(/unroutable/iu);
        expect(tools.filter((tool) => /frozen\s+hub/iu.test(tool.description)).map((tool) => tool.name)).toEqual([]);
    });
});
