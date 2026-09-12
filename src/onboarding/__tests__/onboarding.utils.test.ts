import { describe, expect, it } from 'vitest';

import { EMPTY_STATE, FINISHED_STATE, stateWith } from './fixtures.js';
import {
    currentOnboardingStep,
    isOnboardingFinished,
    isOnboardingStarted,
    onboardingPhase,
} from '../onboarding.utils.js';
import { OnboardingPhase, OnboardingStep } from '../types.js';

describe('the onboarding state read off a raw state', () => {
    it('treats the empty state as not started, not finished, standing on the first step', () => {
        expect(isOnboardingStarted(EMPTY_STATE)).toBe(false);
        expect(isOnboardingFinished(EMPTY_STATE)).toBe(false);
        expect(currentOnboardingStep(EMPTY_STATE)).toBe(OnboardingStep.Intro);
        expect(onboardingPhase(EMPTY_STATE)).toBe(OnboardingPhase.FirstReveal);
    });

    it('is started once the first step is closed', () => {
        const state = stateWith({ version: 1, completedSteps: [OnboardingStep.Intro] });

        expect(isOnboardingStarted(state)).toBe(true);
        expect(currentOnboardingStep(state)).toBe(OnboardingStep.WalletAndCell);
    });

    it('takes the first unclosed step in order, not the first gap', () => {
        const state = stateWith({ version: 1, completedSteps: [OnboardingStep.Reveal, OnboardingStep.Intro] });

        expect(currentOnboardingStep(state)).toBe(OnboardingStep.WalletAndCell);
    });

    it('turns to the second phase after the reveal step', () => {
        const state = stateWith({
            version: 1,
            completedSteps: [OnboardingStep.Intro, OnboardingStep.WalletAndCell, OnboardingStep.Reveal],
        });

        expect(currentOnboardingStep(state)).toBe(OnboardingStep.BuildExtractor);
        expect(onboardingPhase(state)).toBe(OnboardingPhase.Expansion);
    });

    it('is finished and started once the game API stamps a completion', () => {
        expect(isOnboardingFinished(FINISHED_STATE)).toBe(true);
        expect(isOnboardingStarted(FINISHED_STATE)).toBe(true);
        expect(currentOnboardingStep(FINISHED_STATE)).toBeNull();
        expect(onboardingPhase(FINISHED_STATE)).toBeNull();
    });

    it('counts a skipped player as finished', () => {
        const skipped = stateWith({ completedAt: 1_700_000_000, skippedAt: 1_700_000_000, skipReason: 'no thanks' });

        expect(isOnboardingFinished(skipped)).toBe(true);
    });
});
