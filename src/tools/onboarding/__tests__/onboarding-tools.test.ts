import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EMPTY_STATE, FakeApi, makeService, stateOk, stateWith } from '../../../onboarding/__tests__/fixtures.js';
import {
    COMPLETE_ONBOARDING_STEP_TOOL_NAME,
    ONBOARDING_GATE_REFUSAL,
    ONBOARDING_RESTART_PATH,
    ONBOARDING_SKIP_PATH,
    ONBOARDING_STEP_ORDER,
    ONBOARDING_TOOL_NAME,
    ONBOARDING_VERSION,
    RESTART_ONBOARDING_TOOL_NAME,
    SKIP_ONBOARDING_TOOL_NAME,
} from '../../../onboarding/constants.js';
import { completeStepAndFinish } from '../../../onboarding/onboarding.completion.js';
import { currentOnboardingStep, isOnboardingFinished } from '../../../onboarding/onboarding.utils.js';
import {
    type IOnboardingService,
    OnboardingAvailability,
    type OnboardingPhase,
    type OnboardingState,
    type OnboardingStatus,
    OnboardingStep,
} from '../../../onboarding/types.js';
import { createServer } from '../../../server.js';
import { WalletMode, type AppContext } from '../../../types.js';
import { PackageVersionSignal } from '../../../version/types.js';
import type { ToolRegistrar } from '../../types.js';
import { ONBOARDING_STEP_BRIEFS } from '../constants.js';

const PROBE_TOOL = 'cpu_get_game_config';
const PROBE_TEXT = 'probe ran';
const AGENT_ADDRESS = '0x00000000000000000000000000000000000000ab';
const CELLS_ON_ADDRESS = 3;

const stubs = vi.hoisted(() => ({ serverTransport: null as object | null }));

vi.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({
    StdioServerTransport: class StdioServerTransportStub {
        constructor() {
            return stubs.serverTransport as object;
        }
    },
}));

vi.mock('../../config/get-game-config/get-game-config.js', () => ({
    registerGetGameConfigTool: (registrar: ToolRegistrar): void => {
        registrar.registerTool(PROBE_TOOL, { description: 'probe', inputSchema: {} }, () => ({
            content: [{ type: 'text' as const, text: PROBE_TEXT }],
        }));
    },
}));

function readyStatus(state: OnboardingState): OnboardingStatus {
    return { availability: OnboardingAvailability.Ready, state };
}

class FakeOnboardingService implements IOnboardingService {
    public readonly closedSteps: Array<OnboardingStep> = [];
    public completeCalls = 0;
    public readonly skipReasons: Array<string> = [];
    public readonly restartReasons: Array<string> = [];
    private status: OnboardingStatus;
    private readonly afterStep: OnboardingState | null;

    constructor(state: OnboardingState, afterStep: OnboardingState | null = null) {
        this.status = readyStatus(state);
        this.afterStep = afterStep;
    }

    async state(): Promise<OnboardingStatus> {
        return this.status;
    }

    async refresh(): Promise<OnboardingStatus> {
        return this.status;
    }

    async completeStep(step: OnboardingStep): Promise<OnboardingStatus> {
        this.closedSteps.push(step);
        if (this.afterStep !== null) {
            this.status = readyStatus(this.afterStep);
        }
        return this.status;
    }

    async complete(): Promise<OnboardingStatus> {
        this.completeCalls += 1;
        this.status = readyStatus(stateWith({ ...(this.status.state ?? EMPTY_STATE), completedAt: 1_700_000_000 }));
        return this.status;
    }

    async skip(reason: string): Promise<OnboardingStatus> {
        this.skipReasons.push(reason);
        return this.complete();
    }

    async restart(reason: string): Promise<OnboardingStatus> {
        this.restartReasons.push(reason);
        this.status = readyStatus(EMPTY_STATE);
        return this.status;
    }

    async currentStep(): Promise<OnboardingStep | null> {
        return this.status.state === null ? null : currentOnboardingStep(this.status.state);
    }

    async phase(): Promise<OnboardingPhase | null> {
        return null;
    }

    async isFinished(): Promise<boolean> {
        return this.status.state !== null && isOnboardingFinished(this.status.state);
    }

    async isStarted(): Promise<boolean> {
        return this.status.state !== null && this.status.state.completedSteps.length > 0;
    }

    takeUnavailableNotice(): boolean {
        return false;
    }
}

let open: Client | null = null;

async function boot(onboarding: IOnboardingService): Promise<Client> {
    const context = {
        config: { WALLET_MODE: WalletMode.EVM, OPERATOR_PERSONA: false, OPERATOR_ONBOARDING: true },
        wallet: { isReady: () => true, get: () => ({ getAddress: () => AGENT_ADDRESS }) },
        auth: { getAccessToken: vi.fn(async () => 'jwt'), reauthenticate: vi.fn() },
        mapReader: { query: vi.fn(async () => ({ summary: { myCells: CELLS_ON_ADDRESS } })) },
        onboarding,
        packageVersion: {
            currentVersion: '1.0.0',
            check: async () => ({ signal: PackageVersionSignal.Silent, latest: null }),
        },
        backendVersion: { ensureFresh: async (): Promise<void> => undefined, takeResetNotice: () => false },
        logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() },
    } as unknown as AppContext;

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    stubs.serverTransport = serverTransport;
    await createServer(context);

    const client = new Client({ name: 'onboarding-tools-client', version: '0.0.0' });
    await client.connect(clientTransport);
    open = client;
    return client;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    return (await client.callTool({ name, arguments: args })) as CallToolResult;
}

function textOf(result: CallToolResult): string {
    return (result.content ?? []).map((block) => (block.type === 'text' ? block.text : block.type)).join('\n');
}

beforeEach(() => {
    stubs.serverTransport = null;
});

afterEach(async () => {
    await open?.close();
    open = null;
});

describe('cpu_onboarding', () => {
    it('hands back the brief of the step the player actually stands on', async () => {
        const client = await boot(new FakeOnboardingService(stateWith({ completedSteps: [OnboardingStep.Intro] })));

        const result = await call(client, ONBOARDING_TOOL_NAME, {});
        const text = textOf(result);

        expect(result.isError).toBeFalsy();
        expect(text).toContain('step 2/6');
        expect(text).toContain(OnboardingStep.WalletAndCell);
        for (const thesis of ONBOARDING_STEP_BRIEFS[OnboardingStep.WalletAndCell].explain) {
            expect(text).toContain(thesis);
        }
    });

    it('carries the agent wallet address and its cell count into the wallet step', async () => {
        const client = await boot(new FakeOnboardingService(stateWith({ completedSteps: [OnboardingStep.Intro] })));

        const text = textOf(await call(client, ONBOARDING_TOOL_NAME, {}));

        expect(text).toContain(AGENT_ADDRESS);
        expect(text).toContain(String(CELLS_ON_ADDRESS));
    });

    it('opens on the intro and reminds the agent the player may stop', async () => {
        const client = await boot(new FakeOnboardingService(EMPTY_STATE));

        const text = textOf(await call(client, ONBOARDING_TOOL_NAME, {}));

        expect(text).toContain('step 1/6');
        expect(text).toContain(SKIP_ONBOARDING_TOOL_NAME);
    });

    it('offers a rerun instead of a brief once the walkthrough is finished', async () => {
        const finished = stateWith({ completedSteps: [...ONBOARDING_STEP_ORDER], completedAt: 1_700_000_000 });
        const client = await boot(new FakeOnboardingService(finished));

        const text = textOf(await call(client, ONBOARDING_TOOL_NAME, {}));

        expect(text).toContain(RESTART_ONBOARDING_TOOL_NAME);
        expect(text).not.toContain(ONBOARDING_STEP_BRIEFS[OnboardingStep.Intro].explain[0]);
    });

    it('says the walkthrough is unreadable and the game still open when the state cannot be had', async () => {
        const client = await boot(makeService(new FakeApi({ throws: new Error('the game API is down') })));

        const text = textOf(await call(client, ONBOARDING_TOOL_NAME, {}));

        expect(text.toLowerCase()).toContain('unavailable');
    });
});

describe('cpu_complete_onboarding_step', () => {
    it('finishes the whole walkthrough when the mark closes the sixth step', async () => {
        const service = new FakeOnboardingService(
            stateWith({ completedSteps: ONBOARDING_STEP_ORDER.slice(0, 5) }),
            stateWith({ completedSteps: [...ONBOARDING_STEP_ORDER] }),
        );
        const client = await boot(service);

        const result = await call(client, COMPLETE_ONBOARDING_STEP_TOOL_NAME, { step: OnboardingStep.Tour });

        expect(result.isError).toBeFalsy();
        expect(service.closedSteps).toEqual([OnboardingStep.Tour]);
        expect(service.completeCalls).toBe(1);
    });

    it('leaves the walkthrough open and answers with the next brief on an earlier step', async () => {
        const service = new FakeOnboardingService(EMPTY_STATE, stateWith({ completedSteps: [OnboardingStep.Intro] }));
        const client = await boot(service);

        const text = textOf(await call(client, COMPLETE_ONBOARDING_STEP_TOOL_NAME, { step: OnboardingStep.Intro }));

        expect(service.completeCalls).toBe(0);
        expect(text).toContain('step 2/6');
        expect(text).toContain(ONBOARDING_STEP_BRIEFS[OnboardingStep.WalletAndCell].closes);
    });

    it('refuses a step name the walkthrough does not have', async () => {
        const client = await boot(new FakeOnboardingService(EMPTY_STATE));

        const result = await call(client, COMPLETE_ONBOARDING_STEP_TOOL_NAME, { step: 'buy_everything' });

        expect(result.isError).toBe(true);
    });
});

describe('cpu_skip_onboarding', () => {
    it('sends the words of the player and all six steps', async () => {
        const api = new FakeApi(
            stateOk({
                completedSteps: [...ONBOARDING_STEP_ORDER],
                completedAt: 1_700_000_000,
                skippedAt: 1_700_000_000,
                skipReason: 'skip it, I have played before',
            }),
        );
        const client = await boot(makeService(api));

        const result = await call(client, SKIP_ONBOARDING_TOOL_NAME, {
            playerRequest: 'skip it, I have played before',
        });

        expect(result.isError).toBeFalsy();
        expect(api.calls.find((entry) => entry.path === ONBOARDING_SKIP_PATH)?.options?.body).toEqual({
            version: ONBOARDING_VERSION,
            reason: 'skip it, I have played before',
            steps: [...ONBOARDING_STEP_ORDER],
        });
    });

    it('refuses an empty quote', async () => {
        const client = await boot(new FakeOnboardingService(EMPTY_STATE));

        const result = await call(client, SKIP_ONBOARDING_TOOL_NAME, { playerRequest: '   ' });

        expect(result.isError).toBe(true);
    });
});

describe('cpu_restart_onboarding', () => {
    it('arms the gate again so game tools refuse until the intro is closed', async () => {
        const api = new FakeApi(stateOk({ completedSteps: [...ONBOARDING_STEP_ORDER], completedAt: 1_700_000_000 }));
        const client = await boot(makeService(api));

        const before = await call(client, PROBE_TOOL, {});
        api.setOutcome({ status: 200, data: EMPTY_STATE });
        const restarted = await call(client, RESTART_ONBOARDING_TOOL_NAME, { playerRequest: 'run it again please' });
        const after = await call(client, PROBE_TOOL, {});

        expect(before.isError).toBeFalsy();
        expect(restarted.isError).toBeFalsy();
        expect(api.paths).toContain(ONBOARDING_RESTART_PATH);
        expect(after.isError).toBe(true);
        expect(textOf(after)).toContain(ONBOARDING_GATE_REFUSAL);
    });

    it('refuses an empty quote', async () => {
        const client = await boot(new FakeOnboardingService(EMPTY_STATE));

        const result = await call(client, RESTART_ONBOARDING_TOOL_NAME, { playerRequest: '' });

        expect(result.isError).toBe(true);
    });
});

describe('the completion rule the action tools share', () => {
    it('calls complete only once every step is closed', async () => {
        const early = new FakeOnboardingService(EMPTY_STATE, stateWith({ completedSteps: [OnboardingStep.Intro] }));
        const last = new FakeOnboardingService(
            stateWith({ completedSteps: ONBOARDING_STEP_ORDER.slice(0, 5) }),
            stateWith({ completedSteps: [...ONBOARDING_STEP_ORDER] }),
        );

        await completeStepAndFinish(early, OnboardingStep.Intro);
        await completeStepAndFinish(last, OnboardingStep.Tour);

        expect(early.completeCalls).toBe(0);
        expect(last.completeCalls).toBe(1);
    });
});
