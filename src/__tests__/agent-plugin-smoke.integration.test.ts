import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createServer } from '../server.js';
import { PERSONA_TOOL_NAME } from '../tools/persona/constants.js';
import type { ToolRegistrar } from '../tools/types.js';
import type { AppContext } from '../types.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MCP = path.join(REPO_ROOT, 'plugins', 'project-cpu', '.mcp.json');
const NON_PAID_READ = 'cpu_get_game_config';

const stubs = vi.hoisted(() => ({
    serverTransport: null as object | null,
    readCalls: 0,
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: class StdioServerTransportStub {
        constructor() {
            return stubs.serverTransport as object;
        }
    },
}));

vi.mock('../tools/config/get-game-config/get-game-config.js', () => ({
    registerGetGameConfigTool: (registrar: ToolRegistrar): void => {
        registrar.registerTool(NON_PAID_READ, { description: 'read game config', inputSchema: {} }, () => {
            stubs.readCalls += 1;
            return { content: [{ type: 'text' as const, text: 'config read' }] };
        });
    },
}));

let client: Client | null = null;

beforeEach(() => {
    stubs.serverTransport = null;
    stubs.readCalls = 0;
});

afterEach(async () => {
    await client?.close();
    client = null;
});

async function boot(): Promise<Client> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    stubs.serverTransport = serverTransport;
    await createServer({
        config: { OPERATOR_PERSONA: true },
        packageVersion: {
            currentVersion: '0.10.0',
            check: async () => ({ signal: 'silent', latest: null }),
        },
        backendVersion: {
            ensureFresh: async (): Promise<void> => undefined,
            takeResetNotice: () => false,
        },
    } as unknown as AppContext);

    client = new Client({ name: 'project-cpu-plugin-smoke', version: '0.0.0' });
    await client.connect(clientTransport);
    return client;
}

async function call(connected: Client, name: string): Promise<CallToolResult> {
    return (await connected.callTool({ name, arguments: {} })) as CallToolResult;
}

describe('the installed plugin', () => {
    it('starts the published server, serves the persona first, then allows a non-paid game read', async () => {
        const mcp = JSON.parse(fs.readFileSync(MCP, 'utf8')) as {
            mcpServers: { 'project-cpu': { args: Array<string>; command: string } };
        };
        const connected = await boot();
        const { tools } = await connected.listTools();

        expect(mcp.mcpServers['project-cpu']).toEqual({ command: 'npx', args: ['-y', 'project-cpu-mcp@latest'] });
        expect(tools.map((tool) => tool.name)).toContain(PERSONA_TOOL_NAME);
        expect(tools.map((tool) => tool.name)).toContain(NON_PAID_READ);

        expect((await call(connected, NON_PAID_READ)).isError).toBe(true);
        expect((await call(connected, PERSONA_TOOL_NAME)).isError).toBeFalsy();
        expect((await call(connected, NON_PAID_READ)).isError).toBeFalsy();
        expect(stubs.readCalls).toBe(1);
    });
});
