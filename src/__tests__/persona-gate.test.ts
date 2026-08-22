import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createServer } from '../server.js';
import { PERSONA_GATE_REFUSAL, PERSONA_TOOL_NAME } from '../tools/persona/constants.js';
import type { ToolRegistrar } from '../tools/types.js';
import type { AppContext } from '../types.js';
import { formatBlockedError } from '../version/package-version.utils.js';
import { PackageVersionSignal } from '../version/types.js';

const AUTHENTICATE_TOOL = 'cpu_authenticate';
const CURRENT_VERSION = '1.0.0';
const BLOCKING_VERSION = '2.0.0';

const stubs = vi.hoisted(() => ({
    serverTransport: null as object | null,
    probeTool: 'cpu_get_game_config',
    probeText: 'probe ran',
    probeCalls: 0,
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
        registrar.registerTool(stubs.probeTool, { description: 'probe', inputSchema: {} }, () => {
            stubs.probeCalls += 1;
            return { content: [{ type: 'text' as const, text: stubs.probeText }] };
        });
    },
}));

function contextFor(personaEnabled: boolean, blocked = false): AppContext {
    return {
        config: { OPERATOR_PERSONA: personaEnabled },
        packageVersion: {
            currentVersion: CURRENT_VERSION,
            check: async () => ({
                signal: blocked ? PackageVersionSignal.Blocked : PackageVersionSignal.Silent,
                latest: blocked ? BLOCKING_VERSION : null,
            }),
        },
        backendVersion: {
            ensureFresh: async (): Promise<void> => undefined,
            takeResetNotice: () => false,
        },
    } as unknown as AppContext;
}

let client: Client | null = null;

async function boot(context: AppContext): Promise<Client> {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    stubs.serverTransport = serverTransport;
    await createServer(context);

    const connected = new Client({ name: 'persona-gate-test', version: '0.0.0' });
    await connected.connect(clientTransport);
    client = connected;
    return connected;
}

async function call(connected: Client, name: string): Promise<CallToolResult> {
    return (await connected.callTool({ name, arguments: {} })) as CallToolResult;
}

function textOf(result: CallToolResult): Array<string> {
    return (result.content ?? []).map((block) => (block.type === 'text' ? block.text : block.type));
}

beforeEach(() => {
    stubs.probeCalls = 0;
    stubs.serverTransport = null;
});

afterEach(async () => {
    await client?.close();
    client = null;
});

describe('the operating brief gate', () => {
    it('refuses a tool called before the brief was served', async () => {
        const connected = await boot(contextFor(true));

        const result = await call(connected, stubs.probeTool);

        expect(result.isError).toBe(true);
        expect(textOf(result)).toEqual([PERSONA_GATE_REFUSAL]);
        expect(stubs.probeCalls).toBe(0);
    });

    it('refuses authentication too', async () => {
        const connected = await boot(contextFor(true));

        const result = await call(connected, AUTHENTICATE_TOOL);

        expect(result.isError).toBe(true);
        expect(textOf(result)).toEqual([PERSONA_GATE_REFUSAL]);
    });

    it('never refuses the brief tool itself', async () => {
        const connected = await boot(contextFor(true));

        const result = await call(connected, PERSONA_TOOL_NAME);

        expect(result.isError).toBeFalsy();
        expect(textOf(result).join('')).toContain('operator');
    });

    it('lets every tool through once the brief has been served, without a notice', async () => {
        const connected = await boot(contextFor(true));

        await call(connected, PERSONA_TOOL_NAME);
        const result = await call(connected, stubs.probeTool);

        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toEqual([stubs.probeText]);
        expect(stubs.probeCalls).toBe(1);
    });

    it('keeps letting tools through on later calls', async () => {
        const connected = await boot(contextFor(true));

        await call(connected, PERSONA_TOOL_NAME);
        await call(connected, stubs.probeTool);
        const result = await call(connected, stubs.probeTool);

        expect(textOf(result)).toEqual([stubs.probeText]);
        expect(stubs.probeCalls).toBe(2);
    });

    it('starts unserved again in a fresh server process', async () => {
        const first = await boot(contextFor(true));
        await call(first, PERSONA_TOOL_NAME);
        await first.close();

        const second = await boot(contextFor(true));
        const result = await call(second, stubs.probeTool);

        expect(result.isError).toBe(true);
        expect(textOf(result)).toEqual([PERSONA_GATE_REFUSAL]);
    });

    it('runs the version guard before the brief gate', async () => {
        const connected = await boot(contextFor(true, true));

        const result = await call(connected, stubs.probeTool);

        expect(result.isError).toBe(true);
        expect(textOf(result)).toEqual([formatBlockedError(BLOCKING_VERSION, CURRENT_VERSION)]);
    });
});

describe('the operating brief switched off', () => {
    it('refuses nothing', async () => {
        const connected = await boot(contextFor(false));

        const result = await call(connected, stubs.probeTool);

        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toEqual([stubs.probeText]);
        expect(stubs.probeCalls).toBe(1);
    });

    it('registers no brief tool', async () => {
        const connected = await boot(contextFor(false));

        const { tools } = await connected.listTools();

        expect(tools.map((tool) => tool.name)).not.toContain(PERSONA_TOOL_NAME);
    });
});
