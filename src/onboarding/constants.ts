import { OnboardingStep } from './types.js';

export const ONBOARDING_VERSION = 1;

export const ONBOARDING_STEP_ORDER: ReadonlyArray<OnboardingStep> = [
    OnboardingStep.Intro,
    OnboardingStep.WalletAndCell,
    OnboardingStep.Reveal,
    OnboardingStep.BuildExtractor,
    OnboardingStep.StartMining,
    OnboardingStep.Tour,
];

export const ONBOARDING_FIRST_PHASE_STEPS: ReadonlyArray<OnboardingStep> = [
    OnboardingStep.Intro,
    OnboardingStep.WalletAndCell,
    OnboardingStep.Reveal,
];

export const ONBOARDING_STATE_PATH = '/api/v1/onboarding/me';
export const ONBOARDING_STEP_PATH = `${ONBOARDING_STATE_PATH}/steps`;
export const ONBOARDING_COMPLETE_PATH = `${ONBOARDING_STATE_PATH}/complete`;
export const ONBOARDING_SKIP_PATH = `${ONBOARDING_STATE_PATH}/skip`;
export const ONBOARDING_RESTART_PATH = `${ONBOARDING_STATE_PATH}/restart`;

export const ONBOARDING_TOOL_NAME = 'cpu_onboarding';
export const COMPLETE_ONBOARDING_STEP_TOOL_NAME = 'cpu_complete_onboarding_step';
export const SKIP_ONBOARDING_TOOL_NAME = 'cpu_skip_onboarding';
export const RESTART_ONBOARDING_TOOL_NAME = 'cpu_restart_onboarding';

export const ONBOARDING_GATE_ALLOWLIST: ReadonlyArray<string> = [
    'cpu_persona',
    'cpu_authenticate',
    ONBOARDING_TOOL_NAME,
    COMPLETE_ONBOARDING_STEP_TOOL_NAME,
    SKIP_ONBOARDING_TOOL_NAME,
    RESTART_ONBOARDING_TOOL_NAME,
];

export const ONBOARDING_GATE_REFUSAL = [
    'New player: onboarding not started.',
    `Call \`${ONBOARDING_TOOL_NAME}\`, walk the player through it, then retry.`,
].join(' ');

export const ONBOARDING_UNAVAILABLE_NOTICE = 'Onboarding unavailable — continuing without it';

export const ONBOARDING_NOTICE_PREFIX = 'Onboarding: step';
export const ONBOARDING_NOTICE_CALL = `call \`${ONBOARDING_TOOL_NAME}\` for the brief`;
export const ONBOARDING_FIRST_PHASE_PRIORITY = 'priority: get the player to their first reveal';
export const ONBOARDING_NOTICE_SEPARATOR = ' — ';

export const ONBOARDING_NULLABLE_STATE_KEYS: ReadonlyArray<string> = ['completedAt', 'skippedAt', 'skipReason'];
