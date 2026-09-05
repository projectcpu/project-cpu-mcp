import { afterEach, describe, expect, it, vi } from 'vitest';

import { createPayboxPublicScenario, type PayboxPublicScenario } from './paybox-public-scenario.harness.js';

describe('Paybox public acceptance', () => {
    let scenario: PayboxPublicScenario | null = null;

    afterEach(async () => {
        await scenario?.close();
        scenario = null;
    });

    it('bootstraps one autonomous Wallet through registered cpu_authenticate', async () => {
        scenario = await createPayboxPublicScenario();
        scenario.holdAuthCallback();

        const first = await scenario.callAuthenticate();

        expect(first).toEqual({
            status: 'paybox_auth_required',
            instructions:
                'Paybox authorization should open automatically in your browser. If it did not open, use the authorization URL.',
            authorizationUrl: 'https://accounts.paybox.test/authorize?state=acceptance',
        });
        expect(scenario.requests()).toEqual([
            {
                boundary: 'browser',
                operation: 'open_authorization',
                authorizationUrl: 'https://accounts.paybox.test/authorize?state=acceptance',
            },
            { boundary: 'auth_flow', operation: 'accept_callback' },
        ]);
        scenario.releaseAuthCallback();
        await vi.waitFor(() => {
            expect(scenario?.persistedPaybox()).not.toBeNull();
            expect(scenario?.persistedSession()?.jwt).toBe('game-jwt-1');
        });
        expect(await scenario.callAuthenticate()).toEqual({ status: 'authenticated', address: scenario.walletAddress });
        expect(scenario.requestCount('browser', 'open_authorization')).toBe(1);
        expect(scenario.requestCount('game_api', 'verify_siwe')).toBe(1);
    });

    it('keeps one selected Wallet coherent across SIWE, a transaction, restart, and refresh rotation', async () => {
        scenario = await createPayboxPublicScenario();

        await scenario.callAuthenticate();
        await scenario.callAuthenticate();
        await scenario.waitForRequests('game_api', 'verify_siwe', 1);

        expect(await scenario.callAuthenticate()).toEqual({
            status: 'authenticated',
            address: scenario.walletAddress,
        });
        expect(scenario.persistedPaybox()).toEqual(
            expect.objectContaining({
                credentialId: 'wallet-a',
                address: scenario.walletAddress,
                tokens: expect.objectContaining({ accessToken: 'access-a' }),
            }),
        );
        expect(scenario.persistedSession()).toEqual(
            expect.objectContaining({ address: scenario.walletAddress, jwt: 'game-jwt-2' }),
        );

        const withdrawn = await scenario.callWithdraw();

        expect(withdrawn.isError).toBeUndefined();
        expect(scenario.requestCount('sdk', 'sign_transaction')).toBe(1);
        expect(scenario.requestCount('rpc', 'broadcast')).toBe(1);
        expect(scenario.requestCount('rpc', 'wait_for_receipt')).toBe(1);

        scenario.advanceClock(61_000);
        await scenario.restart();
        expect(await scenario.callAuthenticate()).toEqual({
            status: 'authenticated',
            address: scenario.walletAddress,
        });
        expect(scenario.requestCount('sdk', 'refresh_tokens')).toBe(1);
        expect(scenario.persistedPaybox()).toEqual(
            expect.objectContaining({ tokens: expect.objectContaining({ accessToken: 'access-b' }) }),
        );
        expect(scenario.requestCount('browser', 'open_authorization')).toBe(1);
        expect(scenario.requestCount('game_api', 'verify_siwe')).toBe(3);
    });

    it('returns every autonomous grant and persists only the freshly selected credential', async () => {
        scenario = await createPayboxPublicScenario();
        scenario.useMultipleGrants();

        await scenario.callAuthenticate();
        await scenario.callAuthenticate();
        await scenario.waitForRequests('sdk', 'list_grants', 1);

        expect(await scenario.callAuthenticate()).toEqual({
            status: 'wallet_selection_required',
            choices: [
                {
                    credentialId: 'wallet-a',
                    address: scenario.walletAddress,
                    label: 'Acceptance Wallet A',
                    provider: 'Paybox',
                },
                {
                    credentialId: 'wallet-b',
                    address: scenario.walletAddress,
                    label: 'Acceptance Wallet B',
                    provider: 'Paybox',
                },
            ],
        });
        expect(await scenario.callAuthenticate({ payboxCredentialId: 'wallet-b' })).toEqual({
            status: 'authenticated',
            address: scenario.walletAddress,
        });
        expect(scenario.persistedPaybox()).toEqual(expect.objectContaining({ credentialId: 'wallet-b' }));
        expect(scenario.requestCount('sdk', 'list_grants')).toBe(2);
        expect(scenario.requestCount('sdk', 'sign_message')).toBe(1);
    });

    it('preserves bootstrapped authority when no autonomous Wallet grant exists', async () => {
        scenario = await createPayboxPublicScenario();
        scenario.useZeroGrants();

        await scenario.callAuthenticate();
        await scenario.callAuthenticate();
        await scenario.waitForRequests('sdk', 'list_grants', 1);

        expect(await scenario.callAuthenticate()).toEqual({
            code: 'PAYBOX_FULL_ACCESS_WALLET_REQUIRED',
            instructions:
                'Create or grant an EVM Wallet with autonomous access in Paybox, then call cpu_authenticate again.',
            requiredMode: 'autonomous',
            managementUrl: 'https://app.paybox.test',
        });
        expect(scenario.persistedPaybox()).toEqual(
            expect.objectContaining({ credentialId: null, address: null, signingKey: 'pbxk1.abcdefghijklmnop' }),
        );
        expect(scenario.requestCount('sdk', 'sign_message')).toBe(0);
        expect(scenario.requestCount('browser', 'open_authorization')).toBe(1);
    });

    it('force reset clears both persisted auth layers before one new loopback flow', async () => {
        scenario = await createPayboxPublicScenario();
        await scenario.bootstrap();

        expect(scenario.persistedPaybox()).not.toBeNull();
        expect(scenario.persistedSession()).not.toBeNull();
        scenario.holdAuthCallback();

        expect(await scenario.callAuthenticate({ force: true })).toEqual({
            status: 'paybox_auth_required',
            instructions:
                'Paybox authorization should open automatically in your browser. If it did not open, use the authorization URL.',
            authorizationUrl: 'https://accounts.paybox.test/authorize?state=acceptance',
        });
        expect(scenario.persistedPaybox()).toBeNull();
        expect(scenario.persistedSession()).toBeNull();
        expect(scenario.requestCount('browser', 'open_authorization')).toBe(2);
        expect(scenario.requestCount('auth_flow', 'cancel')).toBe(0);
    });

    it('fully resets a disappeared selected grant without substituting another Wallet', async () => {
        scenario = await createPayboxPublicScenario();
        await scenario.bootstrap();
        scenario.replaceSelectedGrant();
        scenario.holdAuthCallback();

        expect(await scenario.callAuthenticate()).toEqual({
            status: 'paybox_auth_required',
            instructions:
                'Paybox authorization should open automatically in your browser. If it did not open, use the authorization URL.',
            authorizationUrl: 'https://accounts.paybox.test/authorize?state=acceptance',
        });
        expect(scenario.persistedPaybox()).toBeNull();
        expect(scenario.persistedSession()).toBeNull();
        expect(scenario.requestCount('browser', 'open_authorization')).toBe(2);
        expect(scenario.requestCount('sdk', 'sign_message')).toBe(1);
    });

    it('fully resets confirmed Paybox authentication rejection and starts recovery once', async () => {
        scenario = await createPayboxPublicScenario();
        await scenario.bootstrap();
        scenario.rejectGrantRequests(403);
        scenario.holdAuthCallback();

        expect(await scenario.callAuthenticate()).toEqual({
            status: 'paybox_auth_required',
            instructions:
                'Paybox authorization should open automatically in your browser. If it did not open, use the authorization URL.',
            authorizationUrl: 'https://accounts.paybox.test/authorize?state=acceptance',
        });
        expect(scenario.persistedPaybox()).toBeNull();
        expect(scenario.persistedSession()).toBeNull();
        expect(scenario.requestCount('sdk', 'list_grants')).toBe(2);
        expect(scenario.requestCount('browser', 'open_authorization')).toBe(2);
    });

    it('ends an ordinary transaction denial once without clearing authority or broadcasting', async () => {
        scenario = await createPayboxPublicScenario();
        await scenario.bootstrap();
        scenario.denyTransactions();

        const result = await scenario.callWithdraw();

        expect(result.isError).toBe(true);
        expect(scenario.resultData(result)).toEqual({ code: 'PAYBOX_OPERATION_DENIED' });
        expect(scenario.persistedPaybox()).not.toBeNull();
        expect(scenario.persistedSession()).not.toBeNull();
        expect(scenario.requestCount('sdk', 'sign_transaction')).toBe(1);
        expect(scenario.requestCount('rpc', 'broadcast')).toBe(0);
        expect(scenario.requestCount('browser', 'open_authorization')).toBe(1);
    });

    it('preserves authority through a temporary transaction-signing outage without replay', async () => {
        scenario = await createPayboxPublicScenario();
        await scenario.bootstrap();
        scenario.outageTransactions();

        const result = await scenario.callWithdraw();

        expect(result.isError).toBe(true);
        expect(scenario.resultData(result)).toEqual({
            code: 'PAYBOX_TEMPORARILY_UNAVAILABLE',
            stateCleared: false,
            retryable: true,
        });
        expect(scenario.persistedPaybox()).not.toBeNull();
        expect(scenario.persistedSession()).not.toBeNull();
        expect(scenario.requestCount('sdk', 'sign_transaction')).toBe(1);
        expect(scenario.requestCount('rpc', 'broadcast')).toBe(0);
        expect(scenario.requestCount('rpc', 'wait_for_receipt')).toBe(0);
    });

    it('clears only the game JWT after one game API 401 and never replays the tool', async () => {
        scenario = await createPayboxPublicScenario();
        await scenario.bootstrap();
        scenario.rejectGameApiReads();

        const result = await scenario.callWithdraw();

        expect(result.isError).toBe(true);
        expect(scenario.resultData(result)).toEqual({
            code: 'AUTHENTICATION_REQUIRED',
            stateCleared: true,
            nextTool: 'cpu_authenticate',
        });
        expect(scenario.persistedPaybox()).not.toBeNull();
        expect(scenario.persistedSession()).toEqual(expect.objectContaining({ jwt: null }));
        expect(scenario.requestCount('game_api', 'read_cell')).toBe(1);
        expect(scenario.requestCount('sdk', 'sign_transaction')).toBe(0);
        expect(scenario.requestCount('rpc', 'broadcast')).toBe(0);
    });

    it('shares one browser launch and public state across concurrent authentication calls', async () => {
        scenario = await createPayboxPublicScenario();
        scenario.holdBrowserStart();
        scenario.holdAuthCallback();

        const first = scenario.callAuthenticate();
        const second = scenario.callAuthenticate();
        await scenario.waitForRequests('browser', 'open_authorization', 1);
        scenario.releaseBrowserStart();

        const expected = {
            status: 'paybox_auth_required',
            instructions:
                'Paybox authorization should open automatically in your browser. If it did not open, use the authorization URL.',
            authorizationUrl: 'https://accounts.paybox.test/authorize?state=acceptance',
        };
        await expect(first).resolves.toEqual(expected);
        await expect(second).resolves.toEqual(expected);
        expect(scenario.requestCount('browser', 'open_authorization')).toBe(1);
        expect(scenario.requestCount('auth_flow', 'accept_callback')).toBe(1);
    });

    it('ignores a late auth callback after force reset without resurrecting credentials', async () => {
        scenario = await createPayboxPublicScenario();
        const releaseOldCallback = scenario.holdAuthCallback();

        await scenario.callAuthenticate();
        await scenario.callAuthenticate();
        await scenario.waitForRequests('auth_flow', 'accept_callback', 1);
        scenario.holdAuthCallback();
        await scenario.callAuthenticate({ force: true });
        releaseOldCallback();
        await scenario.waitForRequests('auth_flow', 'return_callback_material', 1);

        expect(scenario.persistedPaybox()).toBeNull();
        expect(scenario.persistedSession()).toBeNull();
        expect(scenario.requestCount('sdk', 'list_grants')).toBe(0);
        expect(scenario.requestCount('sdk', 'sign_message')).toBe(0);
        expect(scenario.requestCount('browser', 'open_authorization')).toBe(2);
        expect(scenario.requestCount('auth_flow', 'cancel')).toBe(1);
    });
});
