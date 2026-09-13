import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type ApiOutcome, EMPTY_STATE, FakeApi, makeService, stateOk } from './fixtures.js';
import { createServer } from '../../server.js';
import { PERSONA_GATE_REFUSAL, PERSONA_TOOL_NAME } from '../../tools/persona/constants.js';
import type { ToolRegistrar } from '../../tools/types.js';
import { WalletMode, type AppContext } from '../../types.js';
import { PackageVersionSignal } from '../../version/types.js';
import { ONBOARDING_GATE_REFUSAL, ONBOARDING_STATE_PATH } from '../constants.js';
import { OnboardingStep } from '../types.js';

const PROBE_TOOL = 'cpu_get_game_config';
const PROBE_TEXT = 'probe ran';
const AUTHENTICATE_TOOL = 'cpu_authenticate';

const stubs = vi.hoisted(() => ({
    serverTransport: null as object | null,
    probeCalls: 0,
}));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: class StdioServerTransportStub {
        constructor() {
            return stubs.serverTransport as object;
        }
    },
}));

vi.mock('../../tools/config/get-game-config/get-game-config.js', () => ({
    registerGetGameConfigTool: (registrar: ToolRegistrar): void => {
        registrar.registerTool(PROBE_TOOL, { description: 'probe', inputSchema: {} }, () => {
            stubs.probeCalls += 1;
            return { content: [{ type: 'text' as const, text: PROBE_TEXT }] };
        });
    },
}));

interface Harness {
    client: Client;
    api: FakeApi;
}

let open: Client | null = null;

interface BootOptions {
    outcome: ApiOutcome;
    personaEnabled: boolean | null;
}

async function boot(options: BootOptions): Promise<Harness> {
    const api = new FakeApi(options.outcome);
    const context = {
        config: {
            WALLET_MODE: WalletMode.EVM,
            OPERATOR_PERSONA: options.personaEnabled ?? false,
        },
        wallet: { get: () => ({ getAddress: () => '0x1234' }) },
        auth: { getAccessToken: vi.fn(async () => 'jwt'), reauthenticate: vi.fn() },
        onboarding: makeService(api),
        packageVersion: {
            currentVersion: '1.0.0',
            check: async () => ({ signal: PackageVersionSignal.Silent, latest: null }),
        },
        backendVersion: {
            ensureFresh: async (): Promise<void> => undefined,
            takeResetNotice: () => false,
        },
        logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() },
    } as unknown as AppContext;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    stubs.serverTransport = serverTransport;
    await createServer(context);

    const client = new Client({ name: 'onboarding-wiring-client', version: '0.0.0' });
    await client.connect(clientTransport);
    open = client;

    return { client, api };
}

async function call(client: Client, name: string): Promise<CallToolResult> {
    return (await client.callTool({ name, arguments: {} })) as CallToolResult;
}

function textOf(result: CallToolResult): Array<string> {
    return (result.content ?? []).map((block) => (block.type === 'text' ? block.text : block.type));
}

beforeEach(() => {
    stubs.probeCalls = 0;
    stubs.serverTransport = null;
});

afterEach(async () => {
    await open?.close();
    open = null;
});

describe('the onboarding gate through real server registration', () => {
    it('refuses a registered game tool for a player who has not started', async () => {
        const harness = await boot({
            personaEnabled: null,
            outcome: { status: 200, data: EMPTY_STATE },
        });

        const result = await call(harness.client, PROBE_TOOL);

        expect(result.isError).toBe(true);
        expect(textOf(result)).toEqual([ONBOARDING_GATE_REFUSAL]);
        expect(stubs.probeCalls).toBe(0);
    });

    it('stands behind the operating brief gate', async () => {
        const harness = await boot({
            personaEnabled: true,
            outcome: { status: 200, data: EMPTY_STATE },
        });

        const result = await call(harness.client, PROBE_TOOL);

        expect(textOf(result)).toEqual([PERSONA_GATE_REFUSAL]);
        expect(harness.api.calls).toEqual([]);
    });

    it('refuses again once the brief is served', async () => {
        const harness = await boot({
            personaEnabled: true,
            outcome: { status: 200, data: EMPTY_STATE },
        });

        await call(harness.client, PERSONA_TOOL_NAME);
        const result = await call(harness.client, PROBE_TOOL);

        expect(textOf(result)).toEqual([ONBOARDING_GATE_REFUSAL]);
    });

    it('re-reads the onboarding state after a successful authentication', async () => {
        const harness = await boot({
            personaEnabled: null,
            outcome: { status: 200, data: EMPTY_STATE },
        });

        const result = await call(harness.client, AUTHENTICATE_TOOL);

        expect(result.isError).toBeFalsy();
        expect(harness.api.paths).toEqual([ONBOARDING_STATE_PATH]);
    });

    it('carries the notice on a tool answer while the walkthrough runs', async () => {
        const harness = await boot({
            personaEnabled: null,
            outcome: stateOk({ completedSteps: [OnboardingStep.Intro] }),
        });

        const result = await call(harness.client, PROBE_TOOL);

        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toHaveLength(2);
        expect(textOf(result)[1]).toContain('Onboarding: step 2/6');
    });
});
