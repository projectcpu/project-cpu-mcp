import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';

import {
    bootTool,
    type FakeOnboardingService,
    readyOnboarding,
    STARTED_STATE,
    stateMissingOnly,
    type ToolHarness,
} from '../../../onboarding/__tests__/autoclose.harness.js';
import { FINISHED_STATE } from '../../../onboarding/__tests__/fixtures.js';
import { OnboardingStep } from '../../../onboarding/types.js';
import { ModeCostKind, ModeFreeReason, type StartMiningResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { TxStatus } from '../../../wallet/types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerStartMiningTool } from '../start/start-mining.js';

const STARTED: StartMiningResult = {
    tokenId: '42',
    targetResourceId: 5,
    yieldPerCycle: 77,
    batches: 10,
    durationSec: 180,
    modeSwitch: {
        cost: { kind: ModeCostKind.Free, why: ModeFreeReason.FirstPick },
        exact: true,
        burnedCpu: '0',
    },
    approveTxHash: null,
    txHash: '0xmine',
    status: TxStatus.Success,
    blockNumber: '100',
};

interface Boot {
    onboarding: FakeOnboardingService;
    onboardingEnabled: boolean;
}

let open: ToolHarness | null = null;

async function startMining(options: Boot): Promise<CallToolResult> {
    const harness = await bootTool({
        register: (registrar: ToolRegistrar, context: AppContext): void => registerStartMiningTool(registrar, context),
        onboarding: options.onboarding,
        onboardingEnabled: options.onboardingEnabled,
        services: { mining: { startMining: async (): Promise<StartMiningResult> => STARTED } },
    });
    open = harness;
    return harness.call('cpu_start_mining', { tokenId: '42', targetResourceId: 5, batches: 10 });
}

afterEach(async () => {
    await open?.close();
    open = null;
});

describe('the mining step closed by the start-mining tool', () => {
    it('closes on a started job', async () => {
        const onboarding = readyOnboarding(STARTED_STATE);

        const result = await startMining({ onboarding, onboardingEnabled: true });

        expect(result.isError).toBeFalsy();
        expect(onboarding.closedSteps).toEqual([OnboardingStep.StartMining]);
    });

    it('finishes the onboarding when the start was the last open step', async () => {
        const onboarding = readyOnboarding(stateMissingOnly(OnboardingStep.StartMining));

        await startMining({ onboarding, onboardingEnabled: true });

        expect(onboarding.completeCalls).toBe(1);
    });
});

describe('a start whose onboarding write cannot be made', () => {
    it('answers exactly what a recorded start answers and warns instead', async () => {
        const recorded = await startMining({ onboarding: readyOnboarding(STARTED_STATE), onboardingEnabled: true });
        await open?.close();

        const onboarding = readyOnboarding(STARTED_STATE, new Error('onboarding write refused'));
        const failed = await startMining({ onboarding, onboardingEnabled: true });

        expect(failed.isError).toBeFalsy();
        expect(failed.content).toEqual(recorded.content);
        expect(open?.warnings).toHaveLength(1);
    });
});

describe('a start that must not touch the onboarding at all', () => {
    it('writes nothing once the onboarding is finished', async () => {
        const onboarding = readyOnboarding(FINISHED_STATE);

        await startMining({ onboarding, onboardingEnabled: true });

        expect(onboarding.closedSteps).toEqual([]);
    });

    it('writes nothing when onboarding is switched off', async () => {
        const onboarding = readyOnboarding(STARTED_STATE);

        await startMining({ onboarding, onboardingEnabled: false });

        expect(onboarding.closedSteps).toEqual([]);
    });
});
