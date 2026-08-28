import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ApiClient } from '../../api/client.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { PayboxCoordinator } from '../../paybox/coordinator.js';
import { PayboxLoopbackUnavailableError } from '../../paybox/errors.js';
import { PayboxSdkAdapter } from '../../paybox/paybox-sdk.adapter.js';
import {
    PayboxAuthStatus,
    type IPayboxAuthStorage,
    type IPayboxSdkAdapter,
    type PayboxAuthFlow,
    type PayboxSdkClientFactory,
} from '../../paybox/types.js';
import { AuthService } from '../../services/auth.service.js';
import { SessionManager } from '../../session/manager.js';
import { type ISessionStorage, type SessionData, SessionStatus } from '../../session/types.js';
import { WalletMode, type AppContext } from '../../types.js';
import { registerAuthenticateTool } from '../authenticate.js';
import type { ToolRegistrar } from '../types.js';

describe('cpu_authenticate', () => {
    let client: Client | null = null;

    afterEach(async () => {
        await client?.close();
        client = null;
    });

    it('restores the game JWT through retained EVM wallet authority after it was cleared', async () => {
        let jwt: string | null = null;
        const getAccessToken = vi.fn(async () => {
            jwt = 'restored-jwt';
            return jwt;
        });
        const server = new McpServer({ name: 'authenticate-test', version: '0.0.0' });
        registerAuthenticateTool(server, {
            config: { WALLET_MODE: WalletMode.EVM, OPERATOR_PERSONA: false },
            wallet: { get: () => ({ getAddress: () => '0x1234' }) },
            auth: {
                getAccessToken,
                reauthenticate: vi.fn(),
            },
        } as unknown as AppContext);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        client = new Client({ name: 'authenticate-client', version: '0.0.0' });
        await client.connect(clientTransport);

        const result = (await client.callTool({ name: 'cpu_authenticate', arguments: {} })) as CallToolResult;

        expect(result.isError).toBeUndefined();
        expect(result.content).toEqual([{ type: 'text', text: 'Authenticated as 0x1234. Session token stored.' }]);
        expect(getAccessToken).toHaveBeenCalledOnce();
        expect(jwt).toBe('restored-jwt');
    });

    it('restores the game JWT through retained AGW authority after it was cleared', async () => {
        const getAccessToken = vi.fn(async () => 'restored-jwt');
        const authenticateDevice = vi.fn();
        const handler = captureAuthenticateHandler({
            config: { WALLET_MODE: WalletMode.AGW, OPERATOR_PERSONA: false },
            session: {
                isAuthenticated: () => true,
                getSession: () => ({ jwt: null }),
            },
            auth: {
                getAccessToken,
                reauthenticate: vi.fn(),
                getPendingAuth: vi.fn(() => null),
                authenticateDevice,
            },
        } as unknown as AppContext);

        const result = await handler({ force: null });

        expect(result.isError).toBeUndefined();
        expect(result.content).toEqual([
            {
                type: 'text',
                text: 'Authenticated. Session token restored from the retained wallet session.',
            },
        ]);
        expect(getAccessToken).toHaveBeenCalledOnce();
        expect(authenticateDevice).not.toHaveBeenCalled();
    });

    it('returns only the public Paybox pending and authenticated states without secret inputs', async () => {
        const storage: IPayboxAuthStorage = { load: vi.fn(() => null), save: vi.fn(), clear: vi.fn() };
        const flow: PayboxAuthFlow = {
            start: vi.fn(async () => ({ authorizationUrl: 'https://accounts.test/authorize?state=opaque' })),
            finish: vi.fn(async () => ({
                tokens: {
                    clientId: 'client',
                    accessToken: 'access',
                    refreshToken: null,
                    expiresAt: null,
                    resource: null,
                    baseUrl: 'https://api.test',
                },
                signingKey: 'pbxk1.secret',
            })),
            cancel: vi.fn(),
        };
        const authenticate = vi.fn(async () => 'jwt');
        const wallet = new PayboxCoordinator({
            storage,
            flow,
            sdk: {
                refreshTokens: vi.fn(),
                listEligibleAutonomousEvmGrants: vi.fn(async () => ({
                    grants: [
                        {
                            credentialId: 'credential',
                            address: '0x1111111111111111111111111111111111111111',
                            label: null,
                            provider: null,
                        },
                    ],
                    managementUrl: null,
                })),
                createWallet: vi.fn(() => ({ getAddress: () => '0x1111111111111111111111111111111111111111' })),
                signMessage: vi.fn(),
            } as unknown as IPayboxSdkAdapter,
            authenticator: { authenticate, clearSession: vi.fn() },
        });
        const handler = captureAuthenticateHandler({
            config: { WALLET_MODE: WalletMode.PAYBOX, OPERATOR_PERSONA: false },
            wallet,
        } as unknown as AppContext);

        await expect(handler({ force: null })).resolves.toEqual({
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        status: 'paybox_auth_required',
                        instructions:
                            'Open the authorization URL in a local browser to continue Paybox authentication.',
                        authorizationUrl: 'https://accounts.test/authorize?state=opaque',
                    }),
                },
            ],
        });
        await expect(handler({ force: null })).resolves.toEqual({
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        status: PayboxAuthStatus.AuthRequired,
                        instructions:
                            'Open the authorization URL in a local browser to continue Paybox authentication.',
                        authorizationUrl: 'https://accounts.test/authorize?state=opaque',
                    }),
                },
            ],
        });
        await vi.waitFor(() => expect(authenticate).toHaveBeenCalledOnce());
        await expect(handler({ force: null })).resolves.toEqual({
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        status: PayboxAuthStatus.Authenticated,
                        address: '0x1111111111111111111111111111111111111111',
                    }),
                },
            ],
        });
        expect(flow.start).toHaveBeenCalledOnce();
    });

    it('drives Paybox signature verification through game SIWE and persisted session state', async () => {
        const harness = await createPayboxPublicHarness(PAYBOX_ACCOUNT);
        client = harness.toolClient;

        await expect(harness.toolClient.callTool({ name: 'cpu_authenticate', arguments: {} })).resolves.toEqual(
            expect.objectContaining({
                content: [expect.objectContaining({ text: expect.stringContaining('paybox_auth_required') })],
            }),
        );
        await harness.toolClient.callTool({ name: 'cpu_authenticate', arguments: {} });
        await vi.waitFor(() => expect(harness.session.getStatus()).toBe(SessionStatus.Active));

        const authenticated = await harness.toolClient.callTool({ name: 'cpu_authenticate', arguments: {} });

        expect(authenticated).toEqual({
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ status: 'authenticated', address: PAYBOX_ACCOUNT.address }),
                },
            ],
        });
        expect(harness.session.getSession()).toEqual(
            expect.objectContaining({
                walletMode: WalletMode.PAYBOX,
                address: PAYBOX_ACCOUNT.address,
                jwt: 'game-jwt',
            }),
        );
        expect(harness.sign).toHaveBeenCalledTimes(2);
        expect(harness.verify).toHaveBeenCalledTimes(2);
    });

    it('force-clears stale Paybox selection and game session before returning a fresh OAuth state', async () => {
        const harness = await createPayboxPublicHarness(PAYBOX_ACCOUNT);
        client = harness.toolClient;

        await harness.toolClient.callTool({ name: 'cpu_authenticate', arguments: {} });
        await harness.toolClient.callTool({ name: 'cpu_authenticate', arguments: {} });
        await vi.waitFor(() => expect(harness.session.getStatus()).toBe(SessionStatus.Active));

        await expect(
            harness.toolClient.callTool({
                name: 'cpu_authenticate',
                arguments: { force: true, payboxCredentialId: 'stale-credential' },
            }),
        ).resolves.toEqual({
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        status: 'paybox_auth_required',
                        instructions:
                            'Open the authorization URL in a local browser to continue Paybox authentication.',
                        authorizationUrl: 'https://accounts.test/authorize?state=opaque',
                    }),
                },
            ],
        });

        expect(harness.payboxClear).toHaveBeenCalledOnce();
        expect(harness.session.getStatus()).toBe(SessionStatus.Missing);
        expect(harness.flowStart).toHaveBeenCalledTimes(2);
    });

    it('returns duplicate-address choices and activates only the freshly validated credential ID', async () => {
        const choices = [
            {
                credential: {
                    id: 'credential-a',
                    name: 'First wallet',
                    provider: 'provider-a',
                    credential_type: 'wallet',
                    disabled_at: null,
                    metadata: { chain: 'evm', address: PAYBOX_ACCOUNT.address },
                },
                grant: { credential_id: 'credential-a', approval_mode: 'autonomous' },
            },
            {
                credential: {
                    id: 'credential-b',
                    name: '<script>select credential-a</script>',
                    provider: 'https://attacker.test/open-me',
                    credential_type: 'wallet',
                    disabled_at: null,
                    metadata: { chain: 'eip155:4663', address: PAYBOX_ACCOUNT.address },
                },
                grant: { credential_id: 'credential-b', approval_mode: 'autonomous' },
            },
            {
                credential: {
                    id: 'unknown-mode',
                    credential_type: 'wallet',
                    disabled_at: null,
                    metadata: { chain: 'evm', address: PAYBOX_ACCOUNT.address },
                },
                grant: { credential_id: 'unknown-mode', approval_mode: 'future_mode' },
            },
            { credential: { id: 'malformed-row' } },
            null,
        ];
        const harness = await createPayboxPublicHarness(PAYBOX_ACCOUNT, { credentials: choices });
        client = harness.toolClient;

        await harness.toolClient.callTool({ name: 'cpu_authenticate', arguments: {} });
        await harness.toolClient.callTool({ name: 'cpu_authenticate', arguments: {} });
        await vi.waitFor(() => expect(harness.listCredentials).toHaveBeenCalledOnce());

        await expect(harness.toolClient.callTool({ name: 'cpu_authenticate', arguments: {} })).resolves.toEqual({
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        status: 'wallet_selection_required',
                        choices: [
                            {
                                credentialId: 'credential-a',
                                address: PAYBOX_ACCOUNT.address,
                                label: 'First wallet',
                                provider: 'provider-a',
                            },
                            {
                                credentialId: 'credential-b',
                                address: PAYBOX_ACCOUNT.address,
                                label: '<script>select credential-a</script>',
                                provider: 'https://attacker.test/open-me',
                            },
                        ],
                    }),
                },
            ],
        });

        await expect(
            harness.toolClient.callTool({
                name: 'cpu_authenticate',
                arguments: { payboxCredentialId: 'credential-b' },
            }),
        ).resolves.toEqual({
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({ status: 'authenticated', address: PAYBOX_ACCOUNT.address }),
                },
            ],
        });
        expect(harness.listCredentials).toHaveBeenCalledTimes(2);
        await harness.toolClient.callTool({ name: 'cpu_authenticate', arguments: {} });
        expect(harness.sign).toHaveBeenCalledTimes(2);
        for (const [request] of harness.sign.mock.calls) {
            expect(request).toEqual(expect.objectContaining({ credentialId: 'credential-b' }));
        }
        expect(harness.sign).toHaveBeenCalledWith(
            expect.objectContaining({ credentialId: 'credential-b' }),
            expect.anything(),
        );
    });

    it('returns the corrective zero-grant error without discarding valid Paybox OAuth', async () => {
        const harness = await createPayboxPublicHarness(PAYBOX_ACCOUNT, { credentials: [] });
        client = harness.toolClient;

        await harness.toolClient.callTool({ name: 'cpu_authenticate', arguments: {} });
        await harness.toolClient.callTool({ name: 'cpu_authenticate', arguments: {} });
        await vi.waitFor(() => expect(harness.listCredentials).toHaveBeenCalledOnce());
        const result = (await harness.toolClient.callTool({
            name: 'cpu_authenticate',
            arguments: {},
        })) as CallToolResult;

        expect(result.isError).toBe(true);
        expect(result.content).toEqual([
            {
                type: 'text',
                text: JSON.stringify({
                    code: 'PAYBOX_FULL_ACCESS_WALLET_REQUIRED',
                    instructions:
                        'Create or grant an EVM Wallet with autonomous access in Paybox, then call cpu_authenticate again.',
                    requiredMode: 'autonomous',
                    managementUrl: 'https://app.paybox.test',
                }),
            },
        ]);
        expect(harness.payboxSave).toHaveBeenCalledWith(
            expect.objectContaining({
                tokens: expect.objectContaining({ accessToken: 'access' }),
                signingKey: 'pbxk1.abcdefghijklmnop',
                credentialId: null,
                address: null,
            }),
        );
        expect(harness.sign).not.toHaveBeenCalled();
    });

    it('accepts a credential ID only while a Paybox Wallet choice is outstanding', async () => {
        const harness = await createPayboxPublicHarness(PAYBOX_ACCOUNT);
        client = harness.toolClient;

        const result = (await harness.toolClient.callTool({
            name: 'cpu_authenticate',
            arguments: { payboxCredentialId: 'invented' },
        })) as CallToolResult;

        expect(result.isError).toBe(true);
        expect(result.content).toEqual([
            { type: 'text', text: JSON.stringify({ code: 'PAYBOX_WALLET_SELECTION_NOT_PENDING' }) },
        ]);
        expect(harness.flowStart).not.toHaveBeenCalled();
        expect(harness.listCredentials).not.toHaveBeenCalled();
        expect(harness.sign).not.toHaveBeenCalled();
    });

    it('rejects a newly ineligible requested grant without choosing its replacement', async () => {
        const eligible = (id: string, disabledAt: string | null): Record<string, unknown> => ({
            credential: {
                id,
                credential_type: 'wallet',
                disabled_at: disabledAt,
                metadata: { chain: 'evm', address: PAYBOX_ACCOUNT.address },
            },
            grant: { credential_id: id, approval_mode: 'autonomous' },
        });
        const harness = await createPayboxPublicHarness(PAYBOX_ACCOUNT, {
            credentials: [eligible('stale', null), eligible('replacement', null)],
        });
        client = harness.toolClient;

        await harness.toolClient.callTool({ name: 'cpu_authenticate', arguments: {} });
        await harness.toolClient.callTool({ name: 'cpu_authenticate', arguments: {} });
        await vi.waitFor(() => expect(harness.listCredentials).toHaveBeenCalledOnce());
        await harness.toolClient.callTool({ name: 'cpu_authenticate', arguments: {} });
        harness.listCredentials.mockResolvedValueOnce([
            eligible('stale', '2026-01-01T00:00:00Z'),
            eligible('replacement', null),
        ]);

        const result = (await harness.toolClient.callTool({
            name: 'cpu_authenticate',
            arguments: { payboxCredentialId: 'stale' },
        })) as CallToolResult;

        expect(result.isError).toBe(true);
        expect(result.content).toEqual([
            { type: 'text', text: JSON.stringify({ code: 'PAYBOX_WALLET_SELECTION_INVALID' }) },
        ]);
        expect(harness.listCredentials).toHaveBeenCalledTimes(2);
        expect(harness.sign).not.toHaveBeenCalled();
        expect(harness.session.getStatus()).toBe(SessionStatus.Missing);
    });

    it('surfaces unsupported loopback through the registered MCP boundary', async () => {
        const wallet = new PayboxCoordinator({
            storage: { load: () => null, save: vi.fn(), clear: vi.fn() },
            flow: {
                start: vi.fn(async () => Promise.reject(new PayboxLoopbackUnavailableError('unavailable'))),
                finish: vi.fn(),
                cancel: vi.fn(),
            },
            sdk: {} as IPayboxSdkAdapter,
            authenticator: { authenticate: vi.fn(), clearSession: vi.fn() },
        });
        const server = new McpServer({ name: 'unsupported-loopback-test', version: '0.0.0' });
        registerAuthenticateTool(server, {
            config: { WALLET_MODE: WalletMode.PAYBOX, OPERATOR_PERSONA: false },
            wallet,
        } as unknown as AppContext);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        client = new Client({ name: 'unsupported-loopback-client', version: '0.0.0' });
        await client.connect(clientTransport);

        const result = (await client.callTool({ name: 'cpu_authenticate', arguments: {} })) as CallToolResult;

        expect(result.isError).toBe(true);
        expect(result.content).toEqual([
            expect.objectContaining({ text: expect.stringContaining('PAYBOX_AUTH_ENVIRONMENT_UNSUPPORTED') }),
        ]);
    });

    it('fully resets a wrong Paybox signer and restarts OAuth before game verification', async () => {
        const harness = await createPayboxPublicHarness(OTHER_ACCOUNT);
        client = harness.toolClient;

        await harness.toolClient.callTool({ name: 'cpu_authenticate', arguments: {} });
        await harness.toolClient.callTool({ name: 'cpu_authenticate', arguments: {} });
        await vi.waitFor(() => expect(harness.sign).toHaveBeenCalledOnce());
        await new Promise<void>((resolve) => setImmediate(resolve));

        const recovered = (await harness.toolClient.callTool({
            name: 'cpu_authenticate',
            arguments: {},
        })) as CallToolResult;
        expect(recovered).toEqual({
            content: [
                {
                    type: 'text',
                    text: JSON.stringify({
                        status: 'paybox_auth_required',
                        instructions:
                            'Open the authorization URL in a local browser to continue Paybox authentication.',
                        authorizationUrl: 'https://accounts.test/authorize?state=opaque',
                    }),
                },
            ],
        });
        expect(harness.verify).not.toHaveBeenCalled();
        expect(harness.payboxClear).toHaveBeenCalledOnce();
        expect(harness.flowStart).toHaveBeenCalledTimes(2);
        expect(harness.session.getStatus()).toBe(SessionStatus.Missing);
    });
});

const PAYBOX_ACCOUNT = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const OTHER_ACCOUNT = privateKeyToAccount('0x8b3a350cf5c34c9194ca3a545d9b5d4a1f0abf1c9f3c2bb18ce19e6f01a82652');

async function createPayboxPublicHarness(
    signer: typeof PAYBOX_ACCOUNT,
    options: { credentials: unknown } | null = null,
): Promise<{
    toolClient: Client;
    session: SessionManager;
    sign: ReturnType<typeof vi.fn>;
    verify: ReturnType<typeof vi.fn>;
    listCredentials: ReturnType<typeof vi.fn>;
    payboxSave: ReturnType<typeof vi.fn>;
    payboxClear: ReturnType<typeof vi.fn>;
    flowStart: ReturnType<typeof vi.fn>;
}> {
    let sessionData: SessionData | null = null;
    const sessionStorage: ISessionStorage = {
        load: () => sessionData,
        save: (data) => {
            sessionData = data;
        },
        delete: () => {
            sessionData = null;
        },
        exists: () => sessionData !== null,
    };
    const session = new SessionManager({
        storage: sessionStorage,
        walletMode: WalletMode.PAYBOX,
        logger: new NoopLogger(),
    });
    session.initialize();
    const sign = vi.fn(async (args: unknown) => {
        const request = args as { credentialId: string; intent: { message: string } };
        return {
            status: 'success',
            output: {
                output_type: 'signature',
                credential_id: request.credentialId,
                value: await signer.signMessage({ message: request.intent.message }),
            },
        };
    });
    const defaultCredentials = [
        {
            credential: {
                id: 'credential-a',
                credential_type: 'wallet',
                disabled_at: null,
                metadata: { chain: 'evm', address: PAYBOX_ACCOUNT.address },
            },
            grant: { approval_mode: 'autonomous' },
        },
    ];
    const listCredentials = vi.fn(async () => options?.credentials ?? defaultCredentials);
    const sdkFactory: PayboxSdkClientFactory = {
        create: () => ({
            listCredentials,
            requestWalletSign: sign,
        }),
    };
    const verify = vi.fn(async () => ({
        status: 200,
        data: { accessToken: 'game-jwt', user: { id: 'player', address: PAYBOX_ACCOUNT.address } },
    }));
    const request = vi.fn(async (path: string) => {
        if (path.endsWith('/nonce')) {
            return {
                status: 200,
                data: {
                    nonce: 'abc123def456',
                    issuedAt: new Date().toISOString(),
                    expirationTime: new Date(Date.now() + 600_000).toISOString(),
                },
            };
        }
        return verify();
    });
    const api = {
        getBaseUrl: () => 'https://api.projectcpu.test',
        request,
    } as unknown as ApiClient;
    let payboxRecord = null as ReturnType<IPayboxAuthStorage['load']>;
    const payboxSave = vi.fn<IPayboxAuthStorage['save']>((record) => {
        payboxRecord = record;
    });
    const payboxClear = vi.fn(() => {
        payboxRecord = null;
    });
    const storage: IPayboxAuthStorage = {
        load: () => payboxRecord,
        save: payboxSave,
        clear: payboxClear,
    };
    const flowStart = vi.fn(async () => ({ authorizationUrl: 'https://accounts.test/authorize?state=opaque' }));
    const flow: PayboxAuthFlow = {
        start: flowStart,
        finish: vi.fn(async () => ({
            tokens: {
                clientId: 'client',
                accessToken: 'access',
                refreshToken: null,
                expiresAt: null,
                resource: null,
                baseUrl: 'https://api.paybox.test',
            },
            signingKey: 'pbxk1.abcdefghijklmnop',
        })),
        cancel: vi.fn(),
    };
    let auth: AuthService | null = null;
    const wallet = new PayboxCoordinator({
        storage,
        flow,
        sdk: new PayboxSdkAdapter(sdkFactory),
        authenticator: {
            authenticate: (payboxWallet, isCurrent) => {
                if (auth === null) throw new Error('auth service unavailable');
                return auth.authenticateWithWallet(payboxWallet, isCurrent);
            },
            clearSession: () => session.clear(),
        },
    });
    auth = new AuthService({ session, api, wallet, logger: new NoopLogger() });
    const context = {
        config: { WALLET_MODE: WalletMode.PAYBOX, OPERATOR_PERSONA: false },
        wallet,
        auth,
        session,
    } as unknown as AppContext;
    const server = new McpServer({ name: 'paybox-authenticate-test', version: '0.0.0' });
    registerAuthenticateTool(server, context);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const toolClient = new Client({ name: 'paybox-authenticate-client', version: '0.0.0' });
    await toolClient.connect(clientTransport);
    return { toolClient, session, sign, verify, listCredentials, payboxSave, payboxClear, flowStart };
}

function captureAuthenticateHandler(context: AppContext): (args: { force: boolean | null }) => Promise<CallToolResult> {
    let handler: ((args: { force: boolean | null }) => Promise<CallToolResult>) | null = null;
    const registrar = {
        registerTool(
            _name: string,
            _definition: unknown,
            registeredHandler: (args: { force: boolean | null }) => Promise<CallToolResult>,
        ): void {
            handler = registeredHandler;
        },
    } as unknown as ToolRegistrar;

    registerAuthenticateTool(registrar, context);

    if (!handler) {
        throw new Error('cpu_authenticate was not registered');
    }

    return handler;
}
