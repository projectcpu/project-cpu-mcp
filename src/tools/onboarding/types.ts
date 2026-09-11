import { z } from 'zod';

import { OnboardingStep } from '../../onboarding/types.js';

export interface OnboardingStepBrief {
    explain: ReadonlyArray<string>;
    closes: string;
    nextTool: string;
}

export interface OnboardingFacts {
    walletAddress: string | null;
    cellCount: number | null;
}

export const completeOnboardingStepInputSchema = {
    step: z
        .nativeEnum(OnboardingStep)
        .describe('The step to mark as closed. Only a step whose content the player has actually had.'),
};

export const skipOnboardingInputSchema = {
    playerRequest: z
        .string()
        .trim()
        .min(1)
        .describe('The words of the player asking to skip, quoted. Required, and never your own paraphrase.'),
};

export const restartOnboardingInputSchema = {
    playerRequest: z
        .string()
        .trim()
        .min(1)
        .describe('The words of the player asking for a rerun, quoted. Required, and never your own paraphrase.'),
};
