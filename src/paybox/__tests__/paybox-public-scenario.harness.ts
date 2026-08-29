import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { PayboxError } from '@paybox-sh/sdk';
import { getAddress, type Hash, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { vi } from 'vitest';

import { payboxSdkEnvelopeGrantList } from './paybox-sdk-0.8.fixtures.js';
import { AuthenticationRequiredError } from '../../api/authentication-required.error.js';
import type { ApiClient } from '../../api/client.js';
import { Network } from '../../config/network.types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type { RevealCellReader } from '../../map/types.js';
import { AuthService } from '../../services/auth.service.js';
import { CellClient } from '../../services/cell.client.js';
import type { AppConfig, IAppConfig } from '../../services/types.js';
import { WithdrawService } from '../../services/withdraw.service.js';
import { SessionManager } from '../../session/manager.js';
import type { ISessionStorage, SessionData } from '../../session/types.js';
import { registerAuthenticateTool } from '../../tools/authenticate.js';
import { registerWithdrawTool } from '../../tools/withdraw/withdraw.js';
import { WalletMode, type AppContext } from '../../types.js';
import { ContractClient } from '../../wallet/contract-client.js';
import { TxStatus } from '../../wallet/types.js';
import { PayboxCoordinator } from '../auth/coordinator.js';
import { PayboxSdkAdapter } from '../sdk/adapter.js';
import type {
    IPayboxAuthStorage,
    IPayboxRpcClient,
    IPayboxSdkAdapter,
    PayboxAuthRecord,
    PayboxSdkClient,
    PayboxSdkClientFactory,
    PayboxTokenRefresher,
    PayboxWalletAuthority,
} from '../types.js';
import { PayboxWalletManager } from '../wallet/manager.js';

const AUTHORIZATION_URL = 'https://accounts.paybox.test/authorize?state=acceptance';
const walletAccount = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const cellAddress = getAddress('0x0000000000000000000000000000000000001234');
const transactionHash = `0x${'7'.repeat(64)}` as Hash;

enum TransactionResponseMode {
    Denied = 'denied',
    Outage = 'outage',
    Success = 'success',
}

export interface PayboxPublicRequest {
    [key: string]: unknown;
    boundary: string;
    operation: string;
}

interface Deferred {
    promise: Promise<void>;
    resolve(): void;
}

export class PayboxPublicScenario {
    public readonly walletAddress = walletAccount.address;

    private client: Client | null = null;
    private payboxRecord: PayboxAuthRecord | null = null;
    private sessionRecord: SessionData | null = null;
    private nowMs = 0;
    private gameJwtSequence = 0;
    private refreshSequence = 0;
    private grantResponse: unknown = payboxSdkEnvelopeGrantList;
    private grantError: Error | null = null;
    private transactionResponseMode = TransactionResponseMode.Success;
    private gameApiUnauthorized = false;
    private browserStartBarrier: Deferred | null = null;
    private authCallbackBarrier: Deferred | null = null;
    private readonly externalRequests: Array<PayboxPublicRequest> = [];
    private readonly restoreDateNow: () => void;

    public constructor() {
        const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => this.nowMs);
        this.restoreDateNow = () => dateNow.mockRestore();
    }

    public async start(): Promise<void> {
        await this.buildRuntime();
    }

    public async callAuthenticate(arguments_: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
        const result = await this.callTool('cpu_authenticate', arguments_);
        return JSON.parse(toolText(result)) as Record<string, unknown>;
    }

    public callWithdraw(): Promise<CallToolResult> {
        return this.callTool('cpu_withdraw', { tokenId: '42', amount: '100' });
    }

    public resultData(result: CallToolResult): Record<string, unknown> {
        return JSON.parse(toolText(result)) as Record<string, unknown>;
    }

    public async bootstrap(): Promise<void> {
        const expectedVerifications = this.requestCount('game_api', 'verify_siwe') + 1;
        await this.callAuthenticate();
        await this.callAuthenticate();
        await this.waitForRequests('game_api', 'verify_siwe', expectedVerifications);
    }

    public requests(): Array<PayboxPublicRequest> {
        return [...this.externalRequests];
    }

    public requestCount(boundary: string, operation: string): number {
        return this.externalRequests.filter(
            (request) => request.boundary === boundary && request.operation === operation,
        ).length;
    }

    public async waitForRequests(boundary: string, operation: string, count: number): Promise<void> {
        await vi.waitFor(() => {
            if (this.requestCount(boundary, operation) !== count) {
                throw new Error(
                    `Waiting for ${boundary}:${operation} request ${count}; observed ${JSON.stringify(this.requests())}.`,
                );
            }
        });
    }

    public persistedPaybox(): PayboxAuthRecord | null {
        return this.payboxRecord;
    }

    public persistedSession(): SessionData | null {
        return this.sessionRecord;
    }

    public advanceClock(milliseconds: number): void {
        this.nowMs += milliseconds;
    }

    public useMultipleGrants(): void {
        this.grantResponse = {
            credentials: [grantRow('wallet-a', 'Acceptance Wallet A'), grantRow('wallet-b', 'Acceptance Wallet B')],
            ungranted: [],
        };
    }

    public useZeroGrants(): void {
        this.grantResponse = { credentials: [], ungranted: [] };
    }

    public replaceSelectedGrant(): void {
        this.grantResponse = {
            credentials: [grantRow('wallet-replacement', 'Replacement Wallet')],
            ungranted: [],
        };
    }

    public rejectGrantRequests(status: number): void {
        this.grantError = new PayboxError(status, 'Paybox grant request rejected.', 'GET /credentials');
    }

    public denyTransactions(): void {
        this.transactionResponseMode = TransactionResponseMode.Denied;
    }

    public outageTransactions(): void {
        this.transactionResponseMode = TransactionResponseMode.Outage;
    }

    public rejectGameApiReads(): void {
        this.gameApiUnauthorized = true;
    }

    public holdBrowserStart(): void {
        this.browserStartBarrier = deferred();
    }

    public releaseBrowserStart(): void {
        this.browserStartBarrier?.resolve();
        this.browserStartBarrier = null;
    }

    public holdAuthCallback(): void {
        this.authCallbackBarrier = deferred();
    }

    public releaseAuthCallback(): void {
        this.authCallbackBarrier?.resolve();
        this.authCallbackBarrier = null;
    }

    public async restart(): Promise<void> {
        await this.disconnect();
        await this.buildRuntime();
    }

    public async close(): Promise<void> {
        await this.disconnect();
        this.restoreDateNow();
    }

    private async callTool(name: string, arguments_: Record<string, unknown>): Promise<CallToolResult> {
        if (this.client === null) throw new Error('Paybox public scenario is not connected.');
        return (await this.client.callTool({ name, arguments: arguments_ })) as CallToolResult;
    }

    private async disconnect(): Promise<void> {
        await this.client?.close();
        this.client = null;
    }

    private async buildRuntime(): Promise<void> {
        const session = this.createSession();
        const rpc = this.createRpc();
        const sdk = this.createSdk(rpc);
        const storage: IPayboxAuthStorage = {
            load: () => this.payboxRecord,
            save: (record) => {
                this.payboxRecord = record;
            },
            clear: () => {
                this.payboxRecord = null;
            },
        };
        let auth: AuthService | null = null;
        const wallet = new PayboxCoordinator({
            storage,
            flow: {
                start: async (signal) => {
                    signal.addEventListener(
                        'abort',
                        () => this.externalRequests.push({ boundary: 'auth_flow', operation: 'cancel' }),
                        { once: true },
                    );
                    const barrier = this.browserStartBarrier;
                    this.externalRequests.push({
                        boundary: 'browser',
                        operation: 'open_authorization',
                        authorizationUrl: AUTHORIZATION_URL,
                    });
                    await barrier?.promise;
                    return { authorizationUrl: AUTHORIZATION_URL };
                },
                finish: async () => {
                    const barrier = this.authCallbackBarrier;
                    this.externalRequests.push({ boundary: 'auth_flow', operation: 'accept_callback' });
                    await barrier?.promise;
                    this.externalRequests.push({ boundary: 'auth_flow', operation: 'return_callback_material' });
                    return {
                        tokens: {
                            clientId: 'client-a',
                            accessToken: 'access-a',
                            refreshToken: 'refresh-a',
                            expiresAt: 120_000,
                            resource: null,
                            baseUrl: 'https://api.paybox.test',
                        },
                        signingKey: 'pbxk1.abcdefghijklmnop',
                    };
                },
            },
            sdk,
            authenticator: {
                authenticate: (manager, signal) => {
                    if (auth === null) throw new Error('Auth service is not ready.');
                    return auth.authenticateWithWallet(manager, signal);
                },
                clearSession: () => session.clear(),
            },
        });
        const api = this.createGameApi();
        auth = new AuthService({ session, api, wallet, logger: new NoopLogger() });
        const contracts = new ContractClient({ wallet, logger: new NoopLogger(), retry: null });
        const cellClient = new CellClient({ contracts, logger: new NoopLogger() });
        const config = {
            network: Network.ROBINHOOD,
            chainId: 4663,
            contracts: { cell: cellAddress },
        } as unknown as AppConfig;
        const appConfig: IAppConfig = { load: async () => config };
        const mapReader: RevealCellReader = {
            readRevealCell: async () => {
                this.externalRequests.push({ boundary: 'game_api', operation: 'read_cell' });
                if (this.gameApiUnauthorized) {
                    session.clearJwt();
                    throw new AuthenticationRequiredError();
                }
                return null;
            },
        } as unknown as RevealCellReader;
        const withdraw = new WithdrawService({
            wallet,
            appConfig,
            cellClient,
            contracts,
            mapReader,
            logger: new NoopLogger(),
        });
        const context = {
            config: { WALLET_MODE: WalletMode.PAYBOX, OPERATOR_PERSONA: false },
            wallet,
            auth,
            session,
            withdraw,
        } as unknown as AppContext;
        const server = new McpServer({ name: 'paybox-public-acceptance', version: '0.0.0' });
        registerAuthenticateTool(server, context);
        registerWithdrawTool(server, context);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        const client = new Client({ name: 'paybox-public-acceptance-client', version: '0.0.0' });
        await client.connect(clientTransport);
        this.client = client;
    }

    private createSession(): SessionManager {
        const storage: ISessionStorage = {
            load: () => this.sessionRecord,
            save: (record) => {
                this.sessionRecord = record;
            },
            delete: () => {
                this.sessionRecord = null;
            },
            exists: () => this.sessionRecord !== null,
        };
        const session = new SessionManager({ storage, walletMode: WalletMode.PAYBOX, logger: new NoopLogger() });
        session.initialize();
        return session;
    }

    private createGameApi(): ApiClient {
        return {
            getBaseUrl: () => 'https://api.projectcpu.test',
            request: async (path: string, init: unknown) => {
                if (path.endsWith('/nonce')) {
                    this.externalRequests.push({ boundary: 'game_api', operation: 'request_nonce', init });
                    return {
                        status: 200,
                        data: {
                            nonce: 'abc123def456',
                            issuedAt: '2026-08-28T00:00:00.000Z',
                            expirationTime: '2026-08-28T00:10:00.000Z',
                        },
                    };
                }
                this.gameJwtSequence += 1;
                this.externalRequests.push({ boundary: 'game_api', operation: 'verify_siwe', init });
                return {
                    status: 200,
                    data: {
                        accessToken: `game-jwt-${this.gameJwtSequence}`,
                        user: { id: 'acceptance-player', address: this.walletAddress },
                    },
                };
            },
        } as unknown as ApiClient;
    }

    private createSdk(rpc: IPayboxRpcClient): IPayboxSdkAdapter {
        const factory: PayboxSdkClientFactory = {
            create: (options) =>
                ({
                    listCredentials: async () => {
                        this.externalRequests.push({
                            boundary: 'sdk',
                            operation: 'list_grants',
                            accessToken: options.token,
                        });
                        if (this.grantError !== null) throw this.grantError;
                        return this.grantResponse;
                    },
                    requestWalletSign: async (args: unknown) => this.signResponse(args, options.token ?? ''),
                }) as unknown as PayboxSdkClient,
        };
        const refresher: PayboxTokenRefresher = {
            refresh: async (_baseUrl, current) => {
                this.refreshSequence += 1;
                const suffix = String.fromCharCode(98 + this.refreshSequence - 1);
                this.externalRequests.push({
                    boundary: 'sdk',
                    operation: 'refresh_tokens',
                    refreshToken: current.refreshToken,
                });
                return {
                    ...current,
                    accessToken: `access-${suffix}`,
                    refreshToken: `refresh-${suffix}`,
                    expiresAt: this.nowMs + 120_000,
                };
            },
        };
        const boundary = new PayboxSdkAdapter(factory, refresher);
        const sdk: IPayboxSdkAdapter = {
            refreshTokens: (tokens) => boundary.refreshTokens(tokens),
            listEligibleAutonomousEvmGrants: (tokens, signingKey) =>
                boundary.listEligibleAutonomousEvmGrants(tokens, signingKey),
            createWallet: (_tokens, _signingKey, credentialId, address, authority) =>
                this.createWallet(sdk, rpc, credentialId, address, authority),
            signMessage: (tokens, signingKey, credentialId, message) =>
                boundary.signMessage(tokens, signingKey, credentialId, message),
            signTransaction: (tokens, signingKey, credentialId, intent) =>
                boundary.signTransaction(tokens, signingKey, credentialId, intent),
        };
        return sdk;
    }

    private createWallet(
        sdk: IPayboxSdkAdapter,
        rpc: IPayboxRpcClient,
        credentialId: string,
        address: string,
        authority: PayboxWalletAuthority,
    ): PayboxWalletManager {
        return new PayboxWalletManager({
            sdk,
            credentialId,
            address,
            authority,
            rpc,
            logger: new NoopLogger(),
        });
    }

    private async signResponse(args: unknown, accessToken: string): Promise<unknown> {
        const request = args as {
            credentialId: string;
            intent:
                | { op: 'message'; message: string }
                | {
                      op: 'transaction';
                      transaction: {
                          to: `0x${string}`;
                          value: string;
                          data: `0x${string}`;
                          chainId: number;
                          gas: string;
                          maxPriorityFeePerGas: string;
                          maxFeePerGas: string;
                          nonce: number;
                      };
                  };
        };
        if (request.intent.op === 'message') {
            this.externalRequests.push({
                boundary: 'sdk',
                operation: 'sign_message',
                credentialId: request.credentialId,
                accessToken,
            });
            return successResponse(
                request.credentialId,
                await walletAccount.signMessage({ message: request.intent.message }),
            );
        }
        this.externalRequests.push({
            boundary: 'sdk',
            operation: 'sign_transaction',
            credentialId: request.credentialId,
            accessToken,
        });
        if (this.transactionResponseMode === TransactionResponseMode.Denied) return { status: 'denied' };
        if (this.transactionResponseMode === TransactionResponseMode.Outage) {
            throw new PayboxError(503, 'Paybox temporarily unavailable.', 'POST /agent/wallet-sign');
        }
        const intent = request.intent.transaction;
        const serialized = await walletAccount.signTransaction({
            type: 'eip1559',
            to: intent.to,
            value: BigInt(intent.value),
            data: intent.data,
            chainId: intent.chainId,
            gas: BigInt(intent.gas),
            maxPriorityFeePerGas: BigInt(intent.maxPriorityFeePerGas),
            maxFeePerGas: BigInt(intent.maxFeePerGas),
            nonce: intent.nonce,
        });
        return successResponse(request.credentialId, serialized);
    }

    private createRpc(): IPayboxRpcClient {
        return {
            getPendingNonce: async () => {
                this.externalRequests.push({ boundary: 'rpc', operation: 'pending_nonce' });
                return 11;
            },
            estimateEip1559Fees: async () => {
                this.externalRequests.push({ boundary: 'rpc', operation: 'estimate_fees' });
                return { maxPriorityFeePerGas: 2n, maxFeePerGas: 30n };
            },
            estimateGas: async () => {
                this.externalRequests.push({ boundary: 'rpc', operation: 'estimate_gas' });
                return 90_000n;
            },
            sendRawTransaction: async (serializedTransaction: Hex) => {
                this.externalRequests.push({ boundary: 'rpc', operation: 'broadcast', serializedTransaction });
                return transactionHash;
            },
            getGasPrice: async () => 30n,
            waitForReceipt: async (hash) => {
                this.externalRequests.push({ boundary: 'rpc', operation: 'wait_for_receipt', hash });
                return { status: TxStatus.Success, transactionHash, blockNumber: 123n, logs: [] };
            },
            readContract: async () => null,
            getBalance: async () => 0n,
        };
    }
}

export async function createPayboxPublicScenario(): Promise<PayboxPublicScenario> {
    const scenario = new PayboxPublicScenario();
    await scenario.start();
    return scenario;
}

function grantRow(credentialId: string, label: string): unknown {
    return {
        credential: {
            id: credentialId,
            name: label,
            provider: 'Paybox',
            credential_type: 'wallet',
            disabled_at: null,
            metadata: { chain: 'eip155:4663', address: walletAccount.address },
        },
        grant: { credential_id: credentialId, approval_mode: 'autonomous' },
    };
}

function successResponse(credentialId: string, value: Hex): unknown {
    return {
        status: 'success',
        output: {
            output_type: 'signature',
            credential_id: credentialId,
            value: { signature: value, serializedTransaction: value },
        },
    };
}

function toolText(result: CallToolResult): string {
    const block = result.content.find((content) => content.type === 'text');
    if (block?.type !== 'text') throw new Error('MCP tool returned no text result.');
    return block.text;
}

function deferred(): Deferred {
    let resolvePromise: (() => void) | null = null;
    const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
    });
    return {
        promise,
        resolve: () => {
            if (resolvePromise === null) throw new Error('Deferred promise is not initialized.');
            resolvePromise();
        },
    };
}
