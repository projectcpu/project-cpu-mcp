import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { vi } from 'vitest';

import { stateWith } from './fixtures.js';
import { makeConfig } from '../../services/__tests__/service-fakes.js';
import type { ToolRegistrar } from '../../tools/types.js';
import type { AppContext } from '../../types.js';
import { createGuardedRegistrar } from '../../version/tool-guard.js';
import { ONBOARDING_STEP_ORDER } from '../constants.js';
import { createOnboardingGate } from '../onboarding.gate.js';
import {
    currentOnboardingStep,
    isOnboardingFinished,
    isOnboardingStarted,
    onboardingPhaseOf,
} from '../onboarding.utils.js';
import {
    type IOnboardingService,
    OnboardingAvailability,
    type OnboardingPhase,
    type OnboardingState,
    type OnboardingStatus,
    OnboardingStep,
} from '../types.js';

const COMPLETED_AT = 1_700_000_500;

export const STARTED_STATE: OnboardingState = stateWith({
    version: 1,
    completedSteps: [OnboardingStep.Intro, OnboardingStep.WalletAndCell],
});

export function stateMissingOnly(step: OnboardingStep): OnboardingState {
    return stateWith({
        version: 1,
        completedSteps: ONBOARDING_STEP_ORDER.filter((known) => known !== step),
    });
}

export interface FakeOnboardingOptions {
    state: OnboardingState | null;
    availability: OnboardingAvailability;
    writeError: Error | null;
}

export class FakeOnboardingService implements IOnboardingService {
    public readonly closedSteps: Array<OnboardingStep> = [];
    public readonly skipReasons: Array<string> = [];
    public readonly restartReasons: Array<string> = [];
    public completeCalls = 0;

    private current: OnboardingState | null;
    private readonly availability: OnboardingAvailability;
    private readonly writeError: Error | null;
    private unavailableNoticePending: boolean;

    constructor(options: FakeOnboardingOptions) {
        this.current = options.state;
        this.availability = options.availability;
        this.writeError = options.writeError;
        this.unavailableNoticePending = options.availability === OnboardingAvailability.Unavailable;
    }

    async state(): Promise<OnboardingStatus> {
        return this.status();
    }

    async refresh(): Promise<OnboardingStatus> {
        return this.status();
    }

    async completeStep(step: OnboardingStep): Promise<OnboardingStatus> {
        this.closedSteps.push(step);
        this.failWhenAsked();
        if (this.current !== null && !this.current.completedSteps.includes(step)) {
            this.current = { ...this.current, completedSteps: [...this.current.completedSteps, step] };
        }
        return this.status();
    }

    async complete(): Promise<OnboardingStatus> {
        this.completeCalls += 1;
        this.failWhenAsked();
        if (this.current !== null) {
            this.current = { ...this.current, completedAt: COMPLETED_AT };
        }
        return this.status();
    }

    async skip(reason: string): Promise<OnboardingStatus> {
        this.skipReasons.push(reason);
        this.failWhenAsked();
        return this.status();
    }

    async restart(reason: string): Promise<OnboardingStatus> {
        this.restartReasons.push(reason);
        this.failWhenAsked();
        return this.status();
    }

    async currentStep(): Promise<OnboardingStep | null> {
        return this.current === null ? null : currentOnboardingStep(this.current);
    }

    async phase(): Promise<OnboardingPhase | null> {
        const step = await this.currentStep();
        return step === null ? null : onboardingPhaseOf(step);
    }

    async isFinished(): Promise<boolean> {
        return this.current !== null && isOnboardingFinished(this.current);
    }

    async isStarted(): Promise<boolean> {
        return this.current !== null && isOnboardingStarted(this.current);
    }

    takeUnavailableNotice(): boolean {
        const pending = this.unavailableNoticePending;
        this.unavailableNoticePending = false;
        return pending;
    }

    private status(): OnboardingStatus {
        return { availability: this.availability, state: this.current };
    }

    private failWhenAsked(): void {
        if (this.writeError !== null) {
            throw this.writeError;
        }
    }
}

export function readyOnboarding(state: OnboardingState, writeError: Error | null = null): FakeOnboardingService {
    return new FakeOnboardingService({ state, availability: OnboardingAvailability.Ready, writeError });
}

export function unavailableOnboarding(): FakeOnboardingService {
    return new FakeOnboardingService({
        state: null,
        availability: OnboardingAvailability.Unavailable,
        writeError: null,
    });
}

export interface BootOptions {
    register: (registrar: ToolRegistrar, context: AppContext) => void;
    onboarding: FakeOnboardingService;
    services: Record<string, unknown>;
}

export interface ToolHarness {
    call: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
    warnings: Array<unknown>;
    close: () => Promise<void>;
}

export async function bootTool(options: BootOptions): Promise<ToolHarness> {
    const warnings: Array<unknown> = [];
    const context = {
        config: { OPERATOR_PERSONA: false },
        appConfig: { load: async () => makeConfig() },
        onboarding: options.onboarding,
        logger: {
            warn: (message: string, meta: unknown): void => {
                warnings.push({ message, meta });
            },
            info: vi.fn(),
            error: vi.fn(),
            debug: vi.fn(),
            child: vi.fn(),
        },
        ...options.services,
    } as unknown as AppContext;

    const server = new McpServer({ name: 'onboarding-autoclose-test', version: '0.0.0' });
    options.register(createGuardedRegistrar(server, [createOnboardingGate(options.onboarding)]), context);

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'onboarding-autoclose-client', version: '0.0.0' });
    await client.connect(clientTransport);

    return {
        call: async (name: string, args: Record<string, unknown>): Promise<CallToolResult> =>
            (await client.callTool({ name, arguments: args })) as CallToolResult,
        warnings,
        close: async (): Promise<void> => {
            await client.close();
        },
    };
}

export function textOf(result: CallToolResult): Array<string> {
    return (result.content ?? []).map((block) => (block.type === 'text' ? block.text : block.type));
}
