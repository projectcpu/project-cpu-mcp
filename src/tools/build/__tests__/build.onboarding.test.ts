import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { afterEach, describe, expect, it } from 'vitest';

import { BuildingType } from '../../../api/types.js';
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
import type { BuildResult } from '../../../services/types.js';
import type { AppContext } from '../../../types.js';
import type { ToolRegistrar } from '../../types.js';
import { registerBuildTool } from '../build.js';

const PLACED: BuildResult = {
    tokenId: '42',
    buildingType: BuildingType.Mine,
    buildCost: '5',
    approveTxHash: '0xapprove',
    buildTxHash: '0xbuild',
    alreadyBuilt: false,
};

const ALREADY_STANDING: BuildResult = { ...PLACED, approveTxHash: null, buildTxHash: null, alreadyBuilt: true };

const HUB_PLACED: BuildResult = { ...PLACED, buildingType: BuildingType.Hub };

interface Boot {
    onboarding: FakeOnboardingService;
    outcome: BuildResult;
}

let open: ToolHarness | null = null;

async function build(options: Boot): Promise<CallToolResult> {
    const harness = await bootTool({
        register: (registrar: ToolRegistrar, context: AppContext): void => registerBuildTool(registrar, context),
        onboarding: options.onboarding,
        services: { build: { build: async (): Promise<BuildResult> => options.outcome } },
    });
    open = harness;
    return harness.call('cpu_build', { tokenId: '42', buildingType: options.outcome.buildingType });
}

afterEach(async () => {
    await open?.close();
    open = null;
});

describe('the extractor step closed by the build tool', () => {
    it('closes on a build that was sent', async () => {
        const onboarding = readyOnboarding(STARTED_STATE);

        const result = await build({ onboarding, outcome: PLACED });

        expect(result.isError).toBeFalsy();
        expect(onboarding.closedSteps).toEqual([OnboardingStep.BuildExtractor]);
    });

    it('closes on any building type, not only an extractor', async () => {
        const onboarding = readyOnboarding(STARTED_STATE);

        await build({ onboarding, outcome: HUB_PLACED });

        expect(onboarding.closedSteps).toEqual([OnboardingStep.BuildExtractor]);
    });

    it('closes nothing when the cell already carried the building', async () => {
        const onboarding = readyOnboarding(STARTED_STATE);

        await build({ onboarding, outcome: ALREADY_STANDING });

        expect(onboarding.closedSteps).toEqual([]);
    });

    it('finishes the onboarding when the build was the last open step', async () => {
        const onboarding = readyOnboarding(stateMissingOnly(OnboardingStep.BuildExtractor));

        await build({ onboarding, outcome: PLACED });

        expect(onboarding.completeCalls).toBe(1);
    });
});

describe('a build whose onboarding write cannot be made', () => {
    it('answers exactly what a recorded build answers and warns instead', async () => {
        const recorded = await build({
            onboarding: readyOnboarding(STARTED_STATE),
            outcome: PLACED,
        });
        await open?.close();

        const onboarding = readyOnboarding(STARTED_STATE, new Error('onboarding write refused'));
        const failed = await build({ onboarding, outcome: PLACED });

        expect(failed.isError).toBeFalsy();
        expect(failed.content).toEqual(recorded.content);
        expect(open?.warnings).toHaveLength(1);
    });
});

describe('a build that must not touch the onboarding at all', () => {
    it('writes nothing once the onboarding is finished', async () => {
        const onboarding = readyOnboarding(FINISHED_STATE);

        await build({ onboarding, outcome: PLACED });

        expect(onboarding.closedSteps).toEqual([]);
    });
});
