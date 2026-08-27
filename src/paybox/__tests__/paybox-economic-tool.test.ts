import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { getAddress, type Hash, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { describe, expect, it, vi } from 'vitest';

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
import { PayboxSdkAdapter } from '../paybox-sdk.adapter.js';
import { PayboxWalletManager } from '../paybox-wallet.manager.js';
import type { IPayboxRpcClient, PayboxSdkClientFactory, PayboxTokens } from '../types.js';

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
            authority: { current: async () => ({ tokens, signingKey: 'pbxk1.key' }) },
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
});
