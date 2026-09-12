import { describe, expect, it } from 'vitest';

import { EMPTY_STATE, FakeApi, FakeSession, FINISHED_STATE, makeService, SECOND_ADDRESS, stateOk } from './fixtures.js';
import { AuthenticationRequiredError } from '../../api/authentication-required.error.js';
import {
    ONBOARDING_COMPLETE_PATH,
    ONBOARDING_RESTART_PATH,
    ONBOARDING_SKIP_PATH,
    ONBOARDING_STATE_PATH,
    ONBOARDING_STEP_ORDER,
    ONBOARDING_STEP_PATH,
    ONBOARDING_VERSION,
} from '../constants.js';
import { OnboardingAvailability, OnboardingStep } from '../types.js';

const BROKEN_OUTCOMES: Array<[string, { status: number; data: unknown } | { throws: Error }]> = [
    ['404 — the route is not served yet', { status: 404, data: { message: 'Not Found' } }],
    ['500 — the game API failed', { status: 500, data: { message: 'Internal Server Error' } }],
    ['a network throw', { throws: new Error('fetch failed') }],
    ['200 with an unreadable body', { status: 200, data: { completedSteps: 'nope' } }],
];

describe('onboarding state reads', () => {
    it('reads the empty state of a player with no onboarding row', async () => {
        const api = new FakeApi({ status: 200, data: EMPTY_STATE });
        const service = makeService(api);

        const status = await service.state();

        expect(status.availability).toBe(OnboardingAvailability.Ready);
        expect(status.state).toEqual(EMPTY_STATE);
        expect(api.paths).toEqual([ONBOARDING_STATE_PATH]);
    });

    it('reads a body that leaves the nullable marks out', async () => {
        const api = new FakeApi({ status: 200, data: { version: 1, completedSteps: [OnboardingStep.Intro] } });
        const service = makeService(api);

        const status = await service.state();

        expect(status.availability).toBe(OnboardingAvailability.Ready);
        expect(status.state).toEqual({
            version: 1,
            completedSteps: [OnboardingStep.Intro],
            completedAt: null,
            skippedAt: null,
            skipReason: null,
        });
    });

    it('answers repeated reads from one request', async () => {
        const api = new FakeApi({ status: 200, data: EMPTY_STATE });
        const service = makeService(api);

        await service.state();
        await service.state();
        await service.state();

        expect(api.calls).toHaveLength(1);
    });

    it('reads again once the wallet address changes under the cached state', async () => {
        const session = new FakeSession();
        const api = new FakeApi({ status: 200, data: EMPTY_STATE });
        const service = makeService(api, true, session);

        await service.state();
        await service.state();
        session.walletAddress = SECOND_ADDRESS;
        api.setOutcome(stateOk({ completedSteps: [OnboardingStep.Intro] }));
        const afterSwitch = await service.state();

        expect(api.calls).toHaveLength(2);
        expect(afterSwitch.state?.completedSteps).toEqual([OnboardingStep.Intro]);
    });

    it('reads again after a refresh', async () => {
        const api = new FakeApi({ status: 200, data: EMPTY_STATE });
        const service = makeService(api);

        await service.state();
        api.setOutcome(stateOk({ completedSteps: [OnboardingStep.Intro] }));
        const refreshed = await service.refresh();

        expect(api.calls).toHaveLength(2);
        expect(refreshed.state?.completedSteps).toEqual([OnboardingStep.Intro]);
    });

    it('makes no request without an authenticated session', async () => {
        const api = new FakeApi({ status: 200, data: EMPTY_STATE });
        const service = makeService(api, false);

        const status = await service.state();

        expect(status.availability).toBe(OnboardingAvailability.Unauthenticated);
        expect(status.state).toBeNull();
        expect(api.calls).toEqual([]);
    });

    it('reports a rejected token as unauthenticated', async () => {
        const api = new FakeApi({ throws: new AuthenticationRequiredError() });
        const service = makeService(api);

        const status = await service.state();

        expect(status.availability).toBe(OnboardingAvailability.Unauthenticated);
    });

    it.each(BROKEN_OUTCOMES)('falls open on %s', async (_label, outcome) => {
        const api = new FakeApi(outcome);
        const service = makeService(api);

        const status = await service.state();

        expect(status.availability).toBe(OnboardingAvailability.Unavailable);
        expect(status.state).toBeNull();
    });

    it('asks the game API again after an unavailable answer', async () => {
        const api = new FakeApi({ status: 500, data: { message: 'Internal Server Error' } });
        const service = makeService(api);

        await service.state();
        await service.state();

        expect(api.calls).toHaveLength(2);
    });

    it('serves the state once the game API recovers', async () => {
        const api = new FakeApi({ throws: new Error('fetch failed') });
        const service = makeService(api);

        const duringOutage = await service.state();
        api.setOutcome(stateOk({ completedSteps: [OnboardingStep.Intro] }));
        const recovered = await service.state();
        const cached = await service.state();

        expect(duringOutage.availability).toBe(OnboardingAvailability.Unavailable);
        expect(duringOutage.state).toBeNull();
        expect(recovered.availability).toBe(OnboardingAvailability.Ready);
        expect(recovered.state?.completedSteps).toEqual([OnboardingStep.Intro]);
        expect(cached.state?.completedSteps).toEqual([OnboardingStep.Intro]);
        expect(api.calls).toHaveLength(2);
    });

    it('tries the game API again on the next refresh', async () => {
        const api = new FakeApi({ status: 500, data: { message: 'Internal Server Error' } });
        const service = makeService(api);

        await service.state();
        api.setOutcome({ status: 200, data: EMPTY_STATE });
        const recovered = await service.refresh();

        expect(recovered.availability).toBe(OnboardingAvailability.Ready);
        expect(api.calls).toHaveLength(2);
    });
});

describe('onboarding writes', () => {
    it('closes one step and keeps the answer as the new cached state', async () => {
        const api = new FakeApi(stateOk({ completedSteps: [OnboardingStep.Intro] }));
        const service = makeService(api);

        const written = await service.completeStep(OnboardingStep.Intro);
        const cached = await service.state();

        expect(api.calls).toEqual([
            {
                path: ONBOARDING_STEP_PATH,
                options: { method: 'POST', body: { version: ONBOARDING_VERSION, step: OnboardingStep.Intro } },
            },
        ]);
        expect(written.state?.completedSteps).toEqual([OnboardingStep.Intro]);
        expect(cached.state?.completedSteps).toEqual([OnboardingStep.Intro]);
    });

    it('completes the whole onboarding', async () => {
        const api = new FakeApi({ status: 200, data: FINISHED_STATE });
        const service = makeService(api);

        const written = await service.complete();

        expect(api.calls).toEqual([
            { path: ONBOARDING_COMPLETE_PATH, options: { method: 'POST', body: { version: ONBOARDING_VERSION } } },
        ]);
        expect(written.state?.completedAt).toBe(FINISHED_STATE.completedAt);
    });

    it('sends every step and the quoted request when the player skips', async () => {
        const api = new FakeApi({ status: 200, data: FINISHED_STATE });
        const service = makeService(api);

        await service.skip('just let me play');

        expect(api.calls).toEqual([
            {
                path: ONBOARDING_SKIP_PATH,
                options: {
                    method: 'POST',
                    body: {
                        version: ONBOARDING_VERSION,
                        reason: 'just let me play',
                        steps: [...ONBOARDING_STEP_ORDER],
                    },
                },
            },
        ]);
    });

    it('restarts and arms the gate again', async () => {
        const api = new FakeApi({ status: 200, data: EMPTY_STATE });
        const service = makeService(api);

        const written = await service.restart('start over please');

        expect(api.calls).toEqual([
            { path: ONBOARDING_RESTART_PATH, options: { method: 'POST', body: { version: ONBOARDING_VERSION } } },
        ]);
        expect(written.state?.completedSteps).toEqual([]);
    });

    it('accepts a created answer to a write', async () => {
        const api = new FakeApi({ status: 201, data: FINISHED_STATE });
        const service = makeService(api);

        const written = await service.complete();

        expect(written.availability).toBe(OnboardingAvailability.Ready);
    });

    it('throws when a write is refused', async () => {
        const api = new FakeApi({ status: 500, data: { message: 'Internal Server Error' } });
        const service = makeService(api);

        await expect(service.completeStep(OnboardingStep.Intro)).rejects.toThrow(/500/);
    });

    it('throws when a write answers an unreadable body', async () => {
        const api = new FakeApi({ status: 200, data: { completedSteps: 'nope' } });
        const service = makeService(api);

        await expect(service.complete()).rejects.toThrow();
    });
});
