import { describe, expect, it, vi } from 'vitest';

import { createServer, SERVER_INSTRUCTIONS } from '../server.js';
import type { AppContext } from '../types.js';

const INSTRUCTIONS_CHAR_BUDGET = 2000;

const sdk = vi.hoisted(() => ({
    options: new Array<unknown>(),
    toolNames: new Array<string>(),
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
    McpServer: class McpServerStub {
        constructor(_info: unknown, options: unknown) {
            sdk.options.push(options);
        }

        registerTool(name: string): void {
            sdk.toolNames.push(name);
        }

        connect(): Promise<void> {
            return Promise.resolve();
        }
    },
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: class StdioServerTransportStub {},
}));

interface BootedServer {
    delivered: string;
    toolNames: Array<string>;
}

async function bootServer(): Promise<BootedServer> {
    sdk.options.length = 0;
    sdk.toolNames.length = 0;
    await createServer({} as unknown as AppContext);

    const [options] = sdk.options;
    const delivered = (options as { instructions: unknown } | undefined)?.instructions;
    if (typeof delivered !== 'string') {
        throw new Error('the server was constructed without string instructions');
    }
    return { delivered, toolNames: [...sdk.toolNames] };
}

describe('server instructions', () => {
    it('stay under the character budget clients deliver in full', () => {
        expect(SERVER_INSTRUCTIONS.length).toBeLessThan(INSTRUCTIONS_CHAR_BUDGET);
    });

    it('name authentication and the entry point', () => {
        expect(SERVER_INSTRUCTIONS).toContain('cpu_authenticate');
        expect(SERVER_INSTRUCTIONS).toContain('cpu_get_game_config');
    });

    it('keep the route planning loop', () => {
        expect(SERVER_INSTRUCTIONS).toContain('cpu_route_network');
        expect(SERVER_INSTRUCTIONS).toContain('cpu_next_hops');
        expect(SERVER_INSTRUCTIONS).toContain('cpu_quote_transport');
    });
});

describe('instructions handed to the server', () => {
    it('are the ones this module exports', async () => {
        const { delivered } = await bootServer();

        expect(delivered).toBe(SERVER_INSTRUCTIONS);
    });

    it('stay under the character budget', async () => {
        const { delivered } = await bootServer();

        expect(delivered.length).toBeLessThan(INSTRUCTIONS_CHAR_BUDGET);
    });

    it('name no tool the server does not register', async () => {
        const { delivered, toolNames } = await bootServer();
        const named = [...new Set(delivered.match(/cpu_[a-z_]+/g))];

        expect(toolNames.length).toBeGreaterThan(0);
        expect(named.length).toBeGreaterThan(0);
        expect(named.filter((name) => !toolNames.includes(name))).toEqual([]);
    });
});
