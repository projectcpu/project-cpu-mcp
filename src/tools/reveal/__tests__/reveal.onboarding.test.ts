import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';

import {
    bootTool,
    type FakeOnboardingService,
    readyOnboarding,
    STARTED_STATE,
    stateMissingOnly,
    type ToolHarness,
    unavailableOnboarding,
} from '../../../onboarding/__tests__/autoclose.harness.js';
import { FINISHED_STATE } from '../../../onboarding/__tests__/fixtures.js';
import { OnboardingStep } from '../../../onboarding/types.js';
import type { RevealResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import { TxStatus } from '../../../wallet/types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerRevealTool } from '../reveal.js';

const FULFILLED: RevealResult = {
    tokenId: '42',
    genesis: false,
    requestTxHash: '0xrequest',
    fulfillTxHash: '0xfulfil',
    requestId: '7',
    source: '0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa',
    round: '91',
    deposits: [{ resourceId: 5, resourceName: 'Iron', amount: '100', strength: 3 }],
    status: TxStatus.Success,
    blockNumber: '100',
    ethPaid: '0.0001',
    cpuBurn: '0',
    approveTxHash: null,
    fulfilled: true,
    note: null,
};

const PENDING: RevealResult = { ...FULFILLED, fulfillTxHash: null, deposits: null, fulfilled: false };

interface Boot {
    onboarding: FakeOnboardingService;
    outcome: RevealResult;
}

let open: ToolHarness | null = null;

async function reveal(options: Boot): Promise<CallToolResult> {
    const harness = await bootTool({
        register: (registrar: ToolRegistrar, context: AppContext): void => registerRevealTool(registrar, context),
        onboarding: options.onboarding,
        services: { reveal: { reveal: async (): Promise<RevealResult> => options.outcome } },
    });
    open = harness;
    return harness.call('cpu_reveal', { tokenId: '42' });
}

afterEach(async () => {
    await open?.close();
    open = null;
});

describe('the reveal step closed by the reveal tool', () => {
    it('closes on a reveal whose deposits were drawn', async () => {
        const onboarding = readyOnboarding(STARTED_STATE);

        const result = await reveal({ onboarding, outcome: FULFILLED });

        expect(result.isError).toBeFalsy();
        expect(onboarding.closedSteps).toEqual([OnboardingStep.Reveal]);
    });

    it('closes nothing on a request whose draw has not landed', async () => {
        const onboarding = readyOnboarding(STARTED_STATE);

        const result = await reveal({ onboarding, outcome: PENDING });

        expect(result.isError).toBeFalsy();
        expect(onboarding.closedSteps).toEqual([]);
    });

    it('finishes the onboarding when the reveal was the last open step', async () => {
        const onboarding = readyOnboarding(stateMissingOnly(OnboardingStep.Reveal));

        await reveal({ onboarding, outcome: FULFILLED });

        expect(onboarding.closedSteps).toEqual([OnboardingStep.Reveal]);
        expect(onboarding.completeCalls).toBe(1);
    });

    it('leaves the onboarding unfinished while other steps are open', async () => {
        const onboarding = readyOnboarding(STARTED_STATE);

        await reveal({ onboarding, outcome: FULFILLED });

        expect(onboarding.completeCalls).toBe(0);
    });
});

describe('a reveal whose onboarding write cannot be made', () => {
    it('answers exactly what a recorded reveal answers and warns instead', async () => {
        const recorded = await reveal({
            onboarding: readyOnboarding(STARTED_STATE),
            outcome: FULFILLED,
        });
        await open?.close();

        const onboarding = readyOnboarding(STARTED_STATE, new Error('onboarding write refused'));
        const failed = await reveal({ onboarding, outcome: FULFILLED });

        expect(failed.isError).toBeFalsy();
        expect(failed.content).toEqual(recorded.content);
        expect(open?.warnings).toHaveLength(1);
    });
});

describe('a reveal that must not touch the onboarding at all', () => {
    it('writes nothing once the onboarding is finished', async () => {
        const onboarding = readyOnboarding(FINISHED_STATE);

        await reveal({ onboarding, outcome: FULFILLED });

        expect(onboarding.closedSteps).toEqual([]);
        expect(onboarding.completeCalls).toBe(0);
    });

    it('writes nothing while the onboarding state is unavailable', async () => {
        const onboarding = unavailableOnboarding();

        await reveal({ onboarding, outcome: FULFILLED });

        expect(onboarding.closedSteps).toEqual([]);
    });
});
