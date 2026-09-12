import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';

import { type ApiOutcome, EMPTY_STATE, FakeApi, FINISHED_STATE, makeService, stateOk } from './fixtures.js';
import { AuthenticationNextTool } from '../../api/types.js';
import { PERSONA_TOOL_NAME } from '../../tools/persona/constants.js';
import { createGuardedRegistrar } from '../../version/tool-guard.js';
import {
    ONBOARDING_GATE_ALLOWLIST,
    ONBOARDING_GATE_REFUSAL,
    ONBOARDING_TOOL_NAME,
    ONBOARDING_UNAVAILABLE_NOTICE,
} from '../constants.js';
import { createOnboardingGate } from '../onboarding.gate.js';
import { OnboardingAvailability, type IOnboardingService, type OnboardingStatus, OnboardingStep } from '../types.js';

const PROBE_TOOL = 'cpu_get_map';
const PROBE_TEXT = 'probe ran';

const FIRST_PHASE_NOTICE =
    'Onboarding: step 2/6 `wallet_and_cell` — call `cpu_onboarding` for the brief' +
    ' — priority: get the player to their first reveal';
const SECOND_PHASE_NOTICE = 'Onboarding: step 4/6 `build_extractor` — call `cpu_onboarding` for the brief';

const BROKEN_OUTCOMES: Array<[string, ApiOutcome]> = [
    ['404 — the route is not served yet', { status: 404, data: { message: 'Not Found' } }],
    ['500 — the game API failed', { status: 500, data: { message: 'Internal Server Error' } }],
    ['a network throw', { throws: new Error('fetch failed') }],
];

const OUTAGE: OnboardingStatus = { availability: OnboardingAvailability.Unavailable, state: null };
const THROUGH: OnboardingStatus = { availability: OnboardingAvailability.Ready, state: FINISHED_STATE };

function scriptedOnboarding(answers: Array<OnboardingStatus>): IOnboardingService {
    const queue = [...answers];
    const answer = async (): Promise<OnboardingStatus> => queue.shift() ?? OUTAGE;

    return {
        state: answer,
        refresh: answer,
        completeStep: answer,
        complete: answer,
        skip: answer,
        restart: answer,
    };
}

interface Harness {
    client: Client;
    api: FakeApi;
    probeCalls: () => number;
}

let open: Client | null = null;

async function boot(outcome: ApiOutcome, authenticated = true): Promise<Harness> {
    const api = new FakeApi(outcome);
    const server = new McpServer({ name: 'onboarding-gate-test', version: '0.0.0' });
    const registrar = createGuardedRegistrar(server, [createOnboardingGate(makeService(api, authenticated))]);
    let probeCalls = 0;

    registrar.registerTool(PROBE_TOOL, { description: 'probe', inputSchema: {} }, () => {
        probeCalls += 1;
        return { content: [{ type: 'text' as const, text: PROBE_TEXT }] };
    });
    for (const name of ONBOARDING_GATE_ALLOWLIST) {
        registrar.registerTool(name, { description: name, inputSchema: {} }, () => ({
            content: [{ type: 'text' as const, text: name }],
        }));
    }

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'onboarding-gate-client', version: '0.0.0' });
    await client.connect(clientTransport);
    open = client;

    return { client, api, probeCalls: () => probeCalls };
}

async function call(client: Client, name: string): Promise<CallToolResult> {
    return (await client.callTool({ name, arguments: {} })) as CallToolResult;
}

function textOf(result: CallToolResult): Array<string> {
    return (result.content ?? []).map((block) => (block.type === 'text' ? block.text : block.type));
}

afterEach(async () => {
    await open?.close();
    open = null;
});

describe('the onboarding allow-list', () => {
    it('names exactly the six tools that must answer a new player', () => {
        expect([...ONBOARDING_GATE_ALLOWLIST]).toEqual([
            PERSONA_TOOL_NAME,
            AuthenticationNextTool.Authenticate,
            ONBOARDING_TOOL_NAME,
            'cpu_complete_onboarding_step',
            'cpu_skip_onboarding',
            'cpu_restart_onboarding',
        ]);
    });
});

describe('the onboarding gate before the first step', () => {
    it('refuses a game tool and never runs it', async () => {
        const harness = await boot({ status: 200, data: EMPTY_STATE });

        const result = await call(harness.client, PROBE_TOOL);

        expect(result.isError).toBe(true);
        expect(textOf(result)).toEqual([ONBOARDING_GATE_REFUSAL]);
        expect(harness.probeCalls()).toBe(0);
    });

    it('names the onboarding tool in the refusal', async () => {
        const harness = await boot({ status: 200, data: EMPTY_STATE });

        const result = await call(harness.client, PROBE_TOOL);

        expect(textOf(result).join('')).toContain(`\`${ONBOARDING_TOOL_NAME}\``);
    });

    it.each([...ONBOARDING_GATE_ALLOWLIST])('lets %s through', async (name) => {
        const harness = await boot({ status: 200, data: EMPTY_STATE });

        const result = await call(harness.client, name);

        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toEqual([name]);
    });
});

describe('the onboarding gate while the walkthrough runs', () => {
    it('adds the first-phase notice with the reveal priority', async () => {
        const harness = await boot(stateOk({ completedSteps: [OnboardingStep.Intro] }));

        const result = await call(harness.client, PROBE_TOOL);

        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toEqual([PROBE_TEXT, FIRST_PHASE_NOTICE]);
        expect(harness.probeCalls()).toBe(1);
    });

    it('drops the reveal priority in the second phase', async () => {
        const harness = await boot(
            stateOk({
                completedSteps: [OnboardingStep.Intro, OnboardingStep.WalletAndCell, OnboardingStep.Reveal],
            }),
        );

        const result = await call(harness.client, PROBE_TOOL);

        expect(textOf(result)).toEqual([PROBE_TEXT, SECOND_PHASE_NOTICE]);
    });

    it('keeps reminding on every later call', async () => {
        const harness = await boot(stateOk({ completedSteps: [OnboardingStep.Intro] }));

        await call(harness.client, PROBE_TOOL);
        const second = await call(harness.client, PROBE_TOOL);

        expect(textOf(second)).toEqual([PROBE_TEXT, FIRST_PHASE_NOTICE]);
    });

    it('reads the game API once for many tool calls', async () => {
        const harness = await boot(stateOk({ completedSteps: [OnboardingStep.Intro] }));

        await call(harness.client, PROBE_TOOL);
        await call(harness.client, PROBE_TOOL);
        await call(harness.client, PROBE_TOOL);

        expect(harness.api.calls).toHaveLength(1);
    });
});

describe('the onboarding gate once the player is through', () => {
    it('says nothing at all', async () => {
        const harness = await boot({ status: 200, data: FINISHED_STATE });

        const result = await call(harness.client, PROBE_TOOL);

        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toEqual([PROBE_TEXT]);
    });
});

describe('the onboarding gate without a usable answer', () => {
    it.each(BROKEN_OUTCOMES)('lets the tool through on %s and warns once', async (_label, outcome) => {
        const harness = await boot(outcome);

        const first = await call(harness.client, PROBE_TOOL);
        const second = await call(harness.client, PROBE_TOOL);

        expect(first.isError).toBeFalsy();
        expect(textOf(first)).toEqual([PROBE_TEXT, ONBOARDING_UNAVAILABLE_NOTICE]);
        expect(textOf(second)).toEqual([PROBE_TEXT]);
        expect(harness.probeCalls()).toBe(2);
    });

    it('stays silent without an authenticated session and asks the game API nothing', async () => {
        const harness = await boot({ status: 200, data: EMPTY_STATE }, false);

        const result = await call(harness.client, PROBE_TOOL);

        expect(result.isError).toBeFalsy();
        expect(textOf(result)).toEqual([PROBE_TEXT]);
        expect(harness.api.calls).toEqual([]);
    });
});

describe('the onboarding gate notice about an outage', () => {
    it('announces every outage once and speaks again after a recovery', async () => {
        const gate = createOnboardingGate(scriptedOnboarding([OUTAGE, OUTAGE, THROUGH, OUTAGE]));

        expect(await gate.check(PROBE_TOOL)).toEqual([ONBOARDING_UNAVAILABLE_NOTICE]);
        expect(await gate.check(PROBE_TOOL)).toEqual([]);
        expect(await gate.check(PROBE_TOOL)).toEqual([]);
        expect(await gate.check(PROBE_TOOL)).toEqual([ONBOARDING_UNAVAILABLE_NOTICE]);
    });

    it('keeps the notice to the gate it belongs to', async () => {
        const first = createOnboardingGate(scriptedOnboarding([OUTAGE]));
        const second = createOnboardingGate(scriptedOnboarding([OUTAGE]));

        await first.check(PROBE_TOOL);

        expect(await second.check(PROBE_TOOL)).toEqual([ONBOARDING_UNAVAILABLE_NOTICE]);
    });
});
