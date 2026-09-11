import { describe, expect, it } from 'vitest';

import { ONBOARDING_STEP_ORDER } from '../../../onboarding/constants.js';
import { OnboardingStep } from '../../../onboarding/types.js';
import {
    COMPLETE_ONBOARDING_STEP_TOOL_DESCRIPTION,
    ONBOARDING_BRIEF_RULES,
    ONBOARDING_STEP_BRIEFS,
    ONBOARDING_TOOL_DESCRIPTION,
    RESTART_ONBOARDING_TOOL_DESCRIPTION,
    SKIP_ONBOARDING_TOOL_DESCRIPTION,
} from '../constants.js';

const INCOME_PROMISE = /earn|profit|prize pool|guarantee/iu;

const DESCRIPTIONS: ReadonlyArray<[string, string]> = [
    ['cpu_onboarding', ONBOARDING_TOOL_DESCRIPTION],
    ['cpu_complete_onboarding_step', COMPLETE_ONBOARDING_STEP_TOOL_DESCRIPTION],
    ['cpu_skip_onboarding', SKIP_ONBOARDING_TOOL_DESCRIPTION],
    ['cpu_restart_onboarding', RESTART_ONBOARDING_TOOL_DESCRIPTION],
];

function briefText(step: OnboardingStep): string {
    const brief = ONBOARDING_STEP_BRIEFS[step];
    return [...brief.explain, brief.closes, brief.nextTool].join(' ');
}

describe('the step briefs', () => {
    it('cover every step of the walkthrough and nothing else', () => {
        expect(Object.keys(ONBOARDING_STEP_BRIEFS).sort()).toEqual([...ONBOARDING_STEP_ORDER].sort());
    });

    it.each([...ONBOARDING_STEP_ORDER])('carries theses, a closing rule and a next tool: %s', (step) => {
        const brief = ONBOARDING_STEP_BRIEFS[step];

        expect(brief.explain.length).toBeGreaterThan(2);
        expect(brief.explain.every((thesis) => thesis.trim().length > 0)).toBe(true);
        expect(brief.closes.trim().length).toBeGreaterThan(0);
        expect(brief.nextTool).toMatch(/^cpu_[a-z_]+$/u);
    });

    it('opens the walkthrough by saying it can be stopped', () => {
        expect(briefText(OnboardingStep.Intro)).toMatch(/skip/iu);
    });

    it('names the finite reserve as the Emission budget and never as a prize pool', () => {
        const intro = briefText(OnboardingStep.Intro);

        expect(intro).toMatch(/Emission budget/u);
        expect(intro).not.toMatch(/prize pool/iu);
    });

    it.each([...ONBOARDING_STEP_ORDER])('promises no income: %s', (step) => {
        expect(briefText(step)).not.toMatch(INCOME_PROMISE);
    });

    it.each(DESCRIPTIONS)('promises no income in the description of %s', (_name, description) => {
        expect(description).not.toMatch(INCOME_PROMISE);
    });

    it('promises no income in the shared delivery rules', () => {
        expect(ONBOARDING_BRIEF_RULES.join(' ')).not.toMatch(INCOME_PROMISE);
    });

    it('is what the income pattern actually catches', () => {
        expect('you earn a profit from the prize pool, guaranteed').toMatch(INCOME_PROMISE);
    });

    it.each(DESCRIPTIONS)('forbids acting without the player words in %s', (name, description) => {
        if (name !== 'cpu_skip_onboarding' && name !== 'cpu_restart_onboarding') {
            return;
        }
        expect(description).toMatch(/explicit/iu);
        expect(description).toMatch(/never call this on your own/iu);
    });
});
