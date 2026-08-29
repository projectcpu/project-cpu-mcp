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
const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugins', 'project-cpu');
const MCP = path.join(PLUGIN_ROOT, '.mcp.json');
const README = path.join(REPO_ROOT, 'README.md');
const CPU_WORKTREE = process.env.CPU_WORKTREE ?? null;
const NON_PAID_READ = 'cpu_get_game_config';
const CELL_MARKET_TOOLS = [
    'cpu_get_cell_market',
    'cpu_get_my_listings',
    'cpu_get_my_offers',
    'cpu_get_my_offers_received',
    'cpu_list_cell',
    'cpu_make_cell_offer',
    'cpu_buy_cell',
    'cpu_accept_cell_offer',
    'cpu_cancel_order',
];

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

    client = new Client({ name: 'project-cpu-agent-setup', version: '0.0.0' });
    await client.connect(clientTransport);
    return client;
}

async function call(connected: Client, name: string): Promise<CallToolResult> {
    return (await connected.callTool({ name, arguments: {} })) as CallToolResult;
}

function read(file: string): string {
    return fs.readFileSync(file, 'utf8');
}

function pluginFiles(directory: string): Array<string> {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const target = path.join(directory, entry.name);

        return entry.isDirectory() ? pluginFiles(target) : [target];
    });
}

describe('the complete Project CPU agent setup', () => {
    it('uses one installed orchestration source and scoped MCP definition for Claude and Codex without credentials', () => {
        const claude = JSON.parse(read(path.join(PLUGIN_ROOT, '.claude-plugin', 'plugin.json'))) as Record<
            string,
            unknown
        >;
        const codex = JSON.parse(read(path.join(PLUGIN_ROOT, '.codex-plugin', 'plugin.json'))) as Record<
            string,
            unknown
        >;
        const mcp = JSON.parse(read(MCP)) as Record<string, unknown>;
        const setupGuide = read(README);
        const installedFiles = pluginFiles(PLUGIN_ROOT).map(read).join('\n');

        expect(claude.name).toBe('project-cpu');
        expect(codex.skills).toBe('./skills');
        expect(codex.mcpServers).toBe('./.mcp.json');
        expect(mcp).toEqual({
            mcpServers: {
                'project-cpu': {
                    command: 'npx',
                    args: ['-y', 'project-cpu-mcp@latest'],
                },
            },
        });
        expect(setupGuide).toMatch(/Claude Code[\s\S]*--scope local[\s\S]*--scope project[\s\S]*--scope user/iu);
        expect(setupGuide).toMatch(
            /Codex[\s\S]*global[\s\S]*\.agents\/skills\/project-cpu[\s\S]*\.codex\/config\.toml/iu,
        );
        expect(setupGuide).toMatch(/### Authenticate[\s\S]*cpu_persona[\s\S]*cpu_authenticate/iu);
        expect(installedFiles).not.toMatch(/0x[a-f0-9]{64}|mnemonic\s*[:=]|eyJ[a-z0-9_-]{10,}\.[a-z0-9_-]{10,}\./iu);
        expect(CELL_MARKET_TOOLS.every((tool) => installedFiles.includes(`\`${tool}\``))).toBe(true);
    });

    it('starts the configured fixture server, establishes persona, then permits one non-paid read', async () => {
        const connected = await boot();
        const { tools } = await connected.listTools();

        expect(read(MCP)).toContain('project-cpu-mcp@latest');
        expect(tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([PERSONA_TOOL_NAME, NON_PAID_READ]));
        expect((await call(connected, NON_PAID_READ)).isError).toBe(true);
        expect((await call(connected, PERSONA_TOOL_NAME)).isError).toBeFalsy();
        expect((await call(connected, NON_PAID_READ)).isError).toBeFalsy();
        expect(stubs.readCalls).toBe(1);
    });

    it.skipIf(CPU_WORKTREE === null)(
        'connects the frontend bootstrap prompt to the current guide and no CPU-hosted skill',
        () => {
            const frontendPrompt = read(
                path.join(
                    CPU_WORKTREE as string,
                    'apps',
                    'web',
                    'src',
                    'components',
                    'terminal-controls',
                    'terminal-controls.constants.ts',
                ),
            );
            const agentGuide = read(
                path.join(CPU_WORKTREE as string, 'apps', 'docs', 'docs', 'agent', 'using-the-mcp.md'),
            );

            expect(frontendPrompt).toContain('https://github.com/projectcpu/project-cpu-mcp#agent-setup');
            expect(frontendPrompt).toMatch(
                /project-only[\s\S]*global[\s\S]*Paybox[\s\S]*wallet secrets[\s\S]*reload[\s\S]*new session/iu,
            );
            expect(agentGuide).toContain('https://github.com/projectcpu/project-cpu-mcp#agent-setup');
            expect(fs.existsSync(path.join(CPU_WORKTREE as string, 'apps', 'docs', 'static', 'SKILL.md'))).toBe(false);
            expect(fs.existsSync(path.join(CPU_WORKTREE as string, 'docs', 'cpu-agent', 'SKILL.md'))).toBe(false);
        },
    );
});
