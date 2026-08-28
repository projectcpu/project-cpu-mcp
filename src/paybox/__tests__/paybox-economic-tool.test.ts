import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { PayboxError } from '@paybox-sh/sdk';
import { getAddress, type Hash, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

import { AuthenticationRequiredError } from '../../api/authentication-required.error.js';
import { ApiClient } from '../../api/client.js';
import { Network } from '../../config/network.types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import type { RevealCellReader } from '../../map/types.js';
import { CellClient } from '../../services/cell.client.js';
import type { AppConfig, IAppConfig } from '../../services/types.js';
import { WithdrawService } from '../../services/withdraw.service.js';
import { registerWithdrawTool } from '../../tools/withdraw/withdraw.js';
import type { AppContext } from '../../types.js';
import { ContractClient } from '../../wallet/contract-client.js';
import { TxStatus, type WalletProvider } from '../../wallet/types.js';
import { PayboxCoordinator } from '../coordinator.js';
import { PayboxOperationDeniedError } from '../errors.js';
import { PayboxSdkAdapter } from '../paybox-sdk.adapter.js';
import { PayboxWalletManager } from '../paybox-wallet.manager.js';
import type {
    IPayboxAuthStorage,
    IPayboxRpcClient,
    IPayboxSdkAdapter,
    PayboxAuthRecord,
    PayboxSdkClientFactory,
    PayboxTokens,
} from '../types.js';

const key = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const account = privateKeyToAccount(key);
const cell = getAddress('0x0000000000000000000000000000000000001234');
const transactionHash = `0x${'7'.repeat(64)}` as Hash;
const tokens: PayboxTokens = {
    clientId: 'client',
    accessToken: 'access',
    refreshToken: null,
    expiresAt: null,
    resource: null,
    baseUrl: 'https://api.paybox.test',
};

describe('Paybox economic tool flow', () => {
    it('crosses the registered withdraw tool, service, wallet, SDK verification, and RPC boundaries', async () => {
        const requestWalletSign = vi.fn(async (args: unknown) => {
            const wire = (
                args as {
                    intent: {
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
                }
            ).intent.transaction;
            const serializedTransaction = await account.signTransaction({
                type: 'eip1559',
                to: wire.to,
                value: BigInt(wire.value),
                data: wire.data,
                chainId: wire.chainId,
                gas: BigInt(wire.gas),
                maxPriorityFeePerGas: BigInt(wire.maxPriorityFeePerGas),
                maxFeePerGas: BigInt(wire.maxFeePerGas),
                nonce: wire.nonce,
            });
            return {
                status: 'success',
                output: {
                    output_type: 'signature',
                    credential_id: 'persisted-credential',
                    value: serializedTransaction,
                },
            };
        });
        const sdkFactory: PayboxSdkClientFactory = {
            create: vi.fn(() => ({ listCredentials: vi.fn(), requestWalletSign })),
        };
        const sdk = new PayboxSdkAdapter(sdkFactory);
        const sendRawTransaction = vi.fn(async (_serializedTransaction: Hex) => transactionHash);
        const rpc: IPayboxRpcClient = {
            getPendingNonce: vi.fn(async () => 11),
            estimateEip1559Fees: vi.fn(async () => ({ maxPriorityFeePerGas: 2n, maxFeePerGas: 30n })),
            estimateGas: vi.fn(async () => 90_000n),
            sendRawTransaction,
            getGasPrice: vi.fn(async () => 30n),
            waitForReceipt: vi.fn(async () => ({
                status: TxStatus.Success,
                transactionHash,
                blockNumber: 123n,
                logs: [],
            })),
            readContract: vi.fn(),
            getBalance: vi.fn(async () => 0n),
        };
        const wallet = new PayboxWalletManager({
            sdk,
            credentialId: 'persisted-credential',
            address: account.address,
            authority: { current: async () => ({ tokens, signingKey: 'pbxk1.key' }), invalidate: vi.fn() },
            rpc,
            logger: new NoopLogger(),
        });
        const provider: WalletProvider = { get: () => wallet, isReady: () => true };
        const contracts = new ContractClient({ wallet: provider, logger: new NoopLogger(), retry: null });
        const cellClient = new CellClient({ contracts, logger: new NoopLogger() });
        const config = {
            network: Network.ROBINHOOD,
            chainId: 4663,
            contracts: { cell },
        } as unknown as AppConfig;
        const appConfig: IAppConfig = { load: vi.fn(async () => config) };
        const mapReader = { readRevealCell: vi.fn(async () => null) } as unknown as RevealCellReader;
        const withdraw = new WithdrawService({
            wallet: provider,
            appConfig,
            cellClient,
            contracts,
            mapReader,
            logger: new NoopLogger(),
        });
        const server = new McpServer({ name: 'paybox-economic-test', version: '0.0.0' });
        registerWithdrawTool(server, { withdraw } as unknown as AppContext);
        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        await server.connect(serverTransport);
        const client = new Client({ name: 'paybox-economic-client', version: '0.0.0' });
        await client.connect(clientTransport);

        try {
            const result = (await client.callTool({
                name: 'cpu_withdraw',
                arguments: { tokenId: '42', amount: '100' },
            })) as CallToolResult;

            expect(result.isError).toBeUndefined();
            expect(result.content).toEqual(
                expect.arrayContaining([
                    expect.objectContaining({ type: 'text', text: expect.stringContaining('minted 100 $CPU') }),
                ]),
            );
            expect(requestWalletSign).toHaveBeenCalledWith(
                expect.objectContaining({ credentialId: 'persisted-credential' }),
                { autoSign: true },
            );
            expect(sendRawTransaction).toHaveBeenCalledOnce();
            expect(rpc.waitForReceipt).toHaveBeenCalledWith(transactionHash);
        } finally {
            await client.close();
        }
    });

    it.each([
        ['ordinary denial', new PayboxOperationDeniedError(), 'PAYBOX_OPERATION_DENIED'],
        [
            'rate limit',
            new PayboxError(429, 'raw rate-limit body access_token=secret', 'POST /agent/wallet-sign'),
            'PAYBOX_TEMPORARILY_UNAVAILABLE',
        ],
        [
            'service outage',
            new PayboxError(503, 'raw outage body refresh_token=secret', 'POST /agent/wallet-sign'),
            'PAYBOX_TEMPORARILY_UNAVAILABLE',
        ],
        ['network outage', new TypeError('fetch failed access_token=secret'), 'PAYBOX_TEMPORARILY_UNAVAILABLE'],
        [
            'timeout',
            new DOMException('timed out refresh_token=secret', 'TimeoutError'),
            'PAYBOX_TEMPORARILY_UNAVAILABLE',
        ],
    ])('ends once and preserves every auth layer after %s', async (_case, externalError, code) => {
        const scenario = await failedEconomicScenario(externalError);

        expect(scenario.result.isError).toBe(true);
        expect(errorText(scenario.result)).toContain(code);
        expect(errorText(scenario.result)).not.toContain('secret');
        if (code === 'PAYBOX_TEMPORARILY_UNAVAILABLE') {
            expect(JSON.parse(errorText(scenario.result))).toEqual({
                code,
                stateCleared: false,
                retryable: true,
            });
        }
        expect(scenario.state.record).not.toBeNull();
        expect(scenario.state.gameJwt).toBe('game-jwt');
        expect(scenario.state.coordinatorReady).toBe(true);
        expect(scenario.counts).toMatchObject({
            signingRequests: 1,
            payboxClears: 0,
            gameSessionClears: 0,
            oauthStarts: 0,
            browserOpens: 0,
            walletCreations: 1,
            broadcasts: 0,
            receiptWaits: 0,
        });
    });

    it('fully resets once and requires explicit re-invocation after confirmed signing rejection', async () => {
        const scenario = await failedEconomicScenario(
            new PayboxError(403, 'raw key-binding body access_token=secret', 'POST /agent/wallet-sign'),
        );

        expect(scenario.result.isError).toBe(true);
        expect(JSON.parse(errorText(scenario.result))).toEqual({
            code: 'AUTHENTICATION_REQUIRED',
            stateCleared: true,
            nextTool: 'cpu_authenticate',
        });
        expect(errorText(scenario.result)).not.toContain('secret');
        expect(scenario.state.record).toBeNull();
        expect(scenario.state.gameJwt).toBeNull();
        expect(scenario.state.coordinatorReady).toBe(false);
        expect(scenario.counts).toMatchObject({
            signingRequests: 1,
            payboxClears: 1,
            gameSessionClears: 1,
            oauthStarts: 0,
            browserOpens: 0,
            walletCreations: 1,
            broadcasts: 0,
            receiptWaits: 0,
        });
    });

    it('keeps Paybox authority and sends nothing after one game API 401', async () => {
        const fetchRequest = vi.fn(async () => new Response('rejected body access_token=secret', { status: 401 }));
        vi.stubGlobal('fetch', fetchRequest);
        try {
            const scenario = await failedEconomicScenario(null, true);

            expect(scenario.result.isError).toBe(true);
            expect(JSON.parse(errorText(scenario.result))).toEqual({
                code: 'AUTHENTICATION_REQUIRED',
                stateCleared: true,
                nextTool: 'cpu_authenticate',
            });
            expect(errorText(scenario.result)).not.toContain('secret');
            expect(fetchRequest).toHaveBeenCalledOnce();
            expect(scenario.state.record).not.toBeNull();
            expect(scenario.state.gameJwt).toBeNull();
            expect(scenario.state.coordinatorReady).toBe(true);
            expect(scenario.counts).toMatchObject({
                signingRequests: 0,
                payboxClears: 0,
                gameSessionClears: 0,
                oauthStarts: 0,
                browserOpens: 0,
                walletCreations: 1,
                broadcasts: 0,
                receiptWaits: 0,
            });
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

function errorText(result: CallToolResult): string {
    const text = result.content.find((block) => block.type === 'text');
    if (text?.type !== 'text') throw new Error('Expected an MCP text error.');
    return text.text;
}

async function failedEconomicScenario(
    externalError: Error | null,
    gameApiUnauthorized = false,
): Promise<{
    result: CallToolResult;
    state: { record: PayboxAuthRecord | null; gameJwt: string | null; coordinatorReady: boolean };
    counts: Record<string, number>;
}> {
    let record: PayboxAuthRecord | null = {
        version: 1,
        tokens,
        signingKey: 'pbxk1.key',
        credentialId: 'persisted-credential',
        address: account.address,
    };
    let gameJwt: string | null = 'game-jwt';
    const counts = {
        signingRequests: 0,
        payboxClears: 0,
        gameSessionClears: 0,
        oauthStarts: 0,
        browserOpens: 0,
        walletCreations: 0,
        broadcasts: 0,
        receiptWaits: 0,
    };
    const storage: IPayboxAuthStorage = {
        load: () => record,
        save: (next) => {
            record = next;
        },
        clear: () => {
            counts.payboxClears += 1;
            record = null;
        },
    };
    const rpc: IPayboxRpcClient = {
        getPendingNonce: vi.fn(async () => 11),
        estimateEip1559Fees: vi.fn(async () => ({ maxPriorityFeePerGas: 2n, maxFeePerGas: 30n })),
        estimateGas: vi.fn(async () => 90_000n),
        sendRawTransaction: vi.fn(async () => {
            counts.broadcasts += 1;
            return transactionHash;
        }),
        getGasPrice: vi.fn(async () => 30n),
        waitForReceipt: vi.fn(async () => {
            counts.receiptWaits += 1;
            return { status: TxStatus.Success, transactionHash, blockNumber: 123n, logs: [] };
        }),
        readContract: vi.fn(),
        getBalance: vi.fn(async () => 0n),
    };
    const adapterBoundary = new PayboxSdkAdapter({
        create: vi.fn(() => ({
            listCredentials: vi.fn(),
            requestWalletSign: vi.fn(async () => {
                counts.signingRequests += 1;
                throw externalError ?? new Error('signing should not run');
            }),
        })),
    });
    const sdk: IPayboxSdkAdapter = {
        refreshTokens: (current) => adapterBoundary.refreshTokens(current),
        listEligibleAutonomousEvmGrants: (current, signingKey) =>
            adapterBoundary.listEligibleAutonomousEvmGrants(current, signingKey),
        createWallet: (_tokens, _signingKey, credentialId, address, authority) => {
            counts.walletCreations += 1;
            return new PayboxWalletManager({
                sdk,
                credentialId,
                address,
                authority,
                rpc,
                logger: new NoopLogger(),
            });
        },
        signMessage: (current, signingKey, credentialId, message) =>
            adapterBoundary.signMessage(current, signingKey, credentialId, message),
        signTransaction: (current, signingKey, credentialId, intent) =>
            adapterBoundary.signTransaction(current, signingKey, credentialId, intent),
    };
    const coordinator = new PayboxCoordinator({
        storage,
        flow: {
            start: vi.fn(async () => {
                counts.oauthStarts += 1;
                counts.browserOpens += 1;
                return { authorizationUrl: 'https://accounts.test/authorize' };
            }),
            finish: vi.fn(),
            cancel: vi.fn(),
        },
        sdk,
        authenticator: {
            authenticate: vi.fn(),
            clearSession: () => {
                counts.gameSessionClears += 1;
                gameJwt = null;
            },
        },
    });
    const cellContract = cell;
    const config = {
        network: Network.ROBINHOOD,
        chainId: 4663,
        contracts: { cell: cellContract },
    } as unknown as AppConfig;
    const appConfig: IAppConfig = { load: vi.fn(async () => config) };
    let mapReader: RevealCellReader = { readRevealCell: vi.fn(async () => null) } as unknown as RevealCellReader;
    if (gameApiUnauthorized) {
        const api = new ApiClient({
            baseUrl: 'https://api.test',
            session: {
                clearJwt: () => {
                    gameJwt = null;
                },
            },
            logger: new NoopLogger(),
        });
        api.setAuthenticator({
            getAccessToken: vi.fn(async () => gameJwt ?? 'missing-jwt'),
        });
        mapReader = {
            readRevealCell: vi.fn(async () => {
                await api.authenticatedRequest('/api/v1/map/cells/42');
                throw new AuthenticationRequiredError();
            }),
        } as unknown as RevealCellReader;
    }
    const contracts = new ContractClient({ wallet: coordinator, logger: new NoopLogger(), retry: null });
    const cellClient = new CellClient({ contracts, logger: new NoopLogger() });
    const withdraw = new WithdrawService({
        wallet: coordinator,
        appConfig,
        cellClient,
        contracts,
        mapReader,
        logger: new NoopLogger(),
    });
    const server = new McpServer({ name: 'paybox-failure-test', version: '0.0.0' });
    registerWithdrawTool(server, { withdraw } as unknown as AppContext);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: 'paybox-failure-client', version: '0.0.0' });
    await client.connect(clientTransport);
    try {
        const result = (await client.callTool({
            name: 'cpu_withdraw',
            arguments: { tokenId: '42', amount: '100' },
        })) as CallToolResult;
        return {
            result,
            state: { record, gameJwt, coordinatorReady: coordinator.isReady() },
            counts,
        };
    } finally {
        await client.close();
    }
}
