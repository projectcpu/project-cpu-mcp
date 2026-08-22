import { describe, expect, it, vi } from 'vitest';

import { SERVER_INSTRUCTIONS } from '../server.constants.js';
import { createServer } from '../server.js';
import { PERSONA_BRIEF_MARKER, PERSONA_TOOL_NAME } from '../tools/persona/constants.js';
import type { AppContext } from '../types.js';

const INSTRUCTIONS_CHAR_BUDGET = 2000;
const MARKER_MIN_CHARS = 70;
const MARKER_MAX_CHARS = 110;
const AUTHENTICATE_TOOL = 'cpu_authenticate';

interface RegisteredTool {
    name: string;
    description: string;
}

const sdk = vi.hoisted(() => ({
    options: new Array<unknown>(),
    tools: new Array<{ name: string; description: string }>(),
}));

vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
    McpServer: class McpServerStub {
        constructor(_info: unknown, options: unknown) {
            sdk.options.push(options);
        }

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

interface BootedServer {
    delivered: string;
    toolNames: Array<string>;
    tools: Array<RegisteredTool>;
}

async function bootServer(personaEnabled = true): Promise<BootedServer> {
    sdk.options.length = 0;
    sdk.tools.length = 0;
    await createServer({ config: { OPERATOR_PERSONA: personaEnabled } } as unknown as AppContext);

    const [options] = sdk.options;
    const delivered = (options as { instructions: unknown } | undefined)?.instructions;
    if (typeof delivered !== 'string') {
        throw new Error('the server was constructed without string instructions');
    }
    return { delivered, toolNames: sdk.tools.map((tool) => tool.name), tools: [...sdk.tools] };
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

describe('the operating brief on by default', () => {
    it('registers the brief tool', async () => {
        const { toolNames } = await bootServer();

        expect(toolNames).toContain(PERSONA_TOOL_NAME);
    });

    it('sends the agent for the brief from the instructions', async () => {
        const { delivered } = await bootServer();

        expect(delivered).toContain(PERSONA_TOOL_NAME);
        expect(delivered.length).toBeLessThan(INSTRUCTIONS_CHAR_BUDGET);
    });

    it('reaches clients that drop instructions through exactly one tool description', async () => {
        const { tools } = await bootServer();
        const carriers = tools.filter((tool) => tool.description.includes(PERSONA_TOOL_NAME));

        expect(carriers.map((tool) => tool.name)).toEqual([AUTHENTICATE_TOOL]);
        expect(PERSONA_BRIEF_MARKER.length).toBeGreaterThanOrEqual(MARKER_MIN_CHARS);
        expect(PERSONA_BRIEF_MARKER.length).toBeLessThanOrEqual(MARKER_MAX_CHARS);
        expect(carriers[0]?.description).toContain(PERSONA_BRIEF_MARKER);
    });
});

describe('the operating brief switched off', () => {
    it('leaves the brief tool unregistered', async () => {
        const { toolNames } = await bootServer(false);

        expect(toolNames.length).toBeGreaterThan(0);
        expect(toolNames).not.toContain(PERSONA_TOOL_NAME);
    });

    it('removes the pointer from the instructions and keeps the rest of them', async () => {
        const { delivered, toolNames } = await bootServer(false);
        const named = [...new Set(delivered.match(/cpu_[a-z_]+/g))];

        expect(delivered).not.toContain(PERSONA_TOOL_NAME);
        expect(delivered).toContain(AUTHENTICATE_TOOL);
        expect(delivered).toContain('cpu_get_game_config');
        expect(delivered.length).toBeLessThan(INSTRUCTIONS_CHAR_BUDGET);
        expect(named.filter((name) => !toolNames.includes(name))).toEqual([]);
    });

    it('leaves no tool description pointing at a tool that is gone', async () => {
        const { tools } = await bootServer(false);

        expect(tools.filter((tool) => tool.description.includes(PERSONA_TOOL_NAME))).toEqual([]);
    });
});
