import {
    ONBOARDING_ADDRESS_LABEL,
    ONBOARDING_BRIEF_RULES,
    ONBOARDING_BULLET,
    ONBOARDING_CELLS_LABEL,
    ONBOARDING_CLOSES_LABEL,
    ONBOARDING_EXPLAIN_HEADING,
    ONBOARDING_FACTS_HEADING,
    ONBOARDING_FINISHED_TEXT,
    ONBOARDING_LINE_SEPARATOR,
    ONBOARDING_NEXT_TOOL_LABEL,
    ONBOARDING_NO_SESSION_TEXT,
    ONBOARDING_RULES_HEADING,
    ONBOARDING_SECTION_SEPARATOR,
    ONBOARDING_SKIP_REMINDER,
    ONBOARDING_SKIPPED_TEXT,
    ONBOARDING_STATUS_FINISHED,
    ONBOARDING_STATUS_NO_SESSION,
    ONBOARDING_STATUS_PREFIX,
    ONBOARDING_STATUS_SEPARATOR,
    ONBOARDING_STATUS_SKIPPED,
    ONBOARDING_STATUS_UNAVAILABLE,
    ONBOARDING_STEP_BRIEFS,
    ONBOARDING_UNAVAILABLE_TEXT,
    ONBOARDING_UNKNOWN_FACT,
    ONBOARDING_WALLET_MODE_LABEL,
} from './constants.js';
import type { OnboardingFacts } from './types.js';
import { ONBOARDING_STEP_ORDER } from '../../onboarding/constants.js';
import { currentOnboardingStep, isOnboardingFinished, onboardingPhaseOf } from '../../onboarding/onboarding.utils.js';
import {
    OnboardingAvailability,
    type OnboardingState,
    type OnboardingStatus,
    OnboardingStep,
} from '../../onboarding/types.js';

function readyState(status: OnboardingStatus): OnboardingState | null {
    return status.availability === OnboardingAvailability.Ready ? status.state : null;
}

function bullet(line: string): string {
    return `${ONBOARDING_BULLET}${line}`;
}

function factsBlock(step: OnboardingStep, facts: OnboardingFacts): string | null {
    if (step !== OnboardingStep.WalletAndCell) {
        return null;
    }
    return [
        ONBOARDING_FACTS_HEADING,
        bullet(`${ONBOARDING_ADDRESS_LABEL}: ${facts.walletAddress ?? ONBOARDING_UNKNOWN_FACT}`),
        bullet(`${ONBOARDING_CELLS_LABEL}: ${facts.cellCount ?? ONBOARDING_UNKNOWN_FACT}`),
        bullet(`${ONBOARDING_WALLET_MODE_LABEL}: ${facts.walletMode ?? ONBOARDING_UNKNOWN_FACT}`),
    ].join(ONBOARDING_LINE_SEPARATOR);
}

function briefBlock(step: OnboardingStep, facts: OnboardingFacts): string {
    const brief = ONBOARDING_STEP_BRIEFS[step];
    const sections = [
        [ONBOARDING_RULES_HEADING, ...ONBOARDING_BRIEF_RULES.map(bullet)].join(ONBOARDING_LINE_SEPARATOR),
        [ONBOARDING_EXPLAIN_HEADING, ...brief.explain.map(bullet)].join(ONBOARDING_LINE_SEPARATOR),
        [`${ONBOARDING_CLOSES_LABEL} ${brief.closes}`, `${ONBOARDING_NEXT_TOOL_LABEL} \`${brief.nextTool}\``].join(
            ONBOARDING_LINE_SEPARATOR,
        ),
    ];

    const known = factsBlock(step, facts);
    if (known !== null) {
        sections.push(known);
    }
    sections.push(ONBOARDING_SKIP_REMINDER);
    return sections.join(ONBOARDING_SECTION_SEPARATOR);
}

export function onboardingStatusLine(status: OnboardingStatus): string {
    if (status.availability === OnboardingAvailability.Unauthenticated) {
        return `${ONBOARDING_STATUS_PREFIX} ${ONBOARDING_STATUS_NO_SESSION}`;
    }

    const state = readyState(status);
    if (state === null) {
        return `${ONBOARDING_STATUS_PREFIX} ${ONBOARDING_STATUS_UNAVAILABLE}`;
    }

    const step = currentOnboardingStep(state);
    if (isOnboardingFinished(state) || step === null) {
        const mark = state.skippedAt === null ? ONBOARDING_STATUS_FINISHED : ONBOARDING_STATUS_SKIPPED;
        return `${ONBOARDING_STATUS_PREFIX} ${mark}`;
    }

    const position = ONBOARDING_STEP_ORDER.indexOf(step) + 1;
    return [
        `${ONBOARDING_STATUS_PREFIX} step ${position}/${ONBOARDING_STEP_ORDER.length} \`${step}\``,
        `phase ${onboardingPhaseOf(step)}`,
    ].join(ONBOARDING_STATUS_SEPARATOR);
}

export function onboardingBody(status: OnboardingStatus, facts: OnboardingFacts): string {
    if (status.availability === OnboardingAvailability.Unauthenticated) {
        return ONBOARDING_NO_SESSION_TEXT;
    }

    const state = readyState(status);
    if (state === null) {
        return ONBOARDING_UNAVAILABLE_TEXT;
    }

    const step = currentOnboardingStep(state);
    if (isOnboardingFinished(state) || step === null) {
        return state.skippedAt === null
            ? ONBOARDING_FINISHED_TEXT
            : [ONBOARDING_SKIPPED_TEXT, ONBOARDING_FINISHED_TEXT].join(' ');
    }

    return briefBlock(step, facts);
}

export function onboardingReport(
    status: OnboardingStatus,
    facts: OnboardingFacts,
    lead: string | null,
): Array<{ type: 'text'; text: string }> {
    const statusLine = onboardingStatusLine(status);
    const header = lead === null ? statusLine : [lead, statusLine].join(ONBOARDING_LINE_SEPARATOR);
    return [
        { type: 'text', text: header },
        { type: 'text', text: onboardingBody(status, facts) },
    ];
}
