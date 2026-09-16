import type { Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { LAUNCH_CHAIN_ID } from '../../config/constants.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import { MarketApiClient } from '../../services/market/client.js';
import { MarketListingService } from '../../services/market/listing.service.js';
import { MarketProfileClient } from '../../services/market/profile.client.js';
import { MarketRecoveryStore } from '../../services/market/recovery.store.js';
import { MarketSingleFlight } from '../../services/market/single-flight.js';
import { MarketActionStatus } from '../../services/market/types.js';
import { captureMarketTool } from '../../tools/market/__tests__/fixtures.js';
import {
    CONDUIT,
    CONDUIT_REGISTRY,
    FakeAppConfig,
    listCellArgs,
    listingsPageWire,
    MarketRoute,
    NOW_SECONDS,
    preparedWire,
    reply,
    RoutedMarketTransport,
    seaportOrderWire,
    SUBMIT_PATH,
    submittedWire,
} from '../../tools/market/list-cell/__tests__/fixtures.js';
import { createListCellTool } from '../../tools/market/list-cell/list-cell.js';
import { TxStatus, type WalletProvider } from '../../wallet/types.js';
import { PayboxSdkAdapter } from '../sdk/adapter.js';
import type { IPayboxRpcClient, PayboxSdkClient, PayboxSdkClientFactory, PayboxTokens } from '../types.js';
import { PayboxWalletManager } from '../wallet/manager.js';

const privateKey = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d';
const account = privateKeyToAccount(privateKey);
const transactionHash = `0x${'7'.repeat(64)}` as const;
const tokens: PayboxTokens = {
    clientId: 'client',
    accessToken: 'access',
    refreshToken: null,
    expiresAt: null,
    resource: null,
    baseUrl: 'https://api.paybox.test',
};

describe('Paybox Cell marketplace flow', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(NOW_SECONDS * 1_000);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('prepares, signs through Paybox, and submits a listing through the MCP tool', async () => {
        const order = seaportOrderWire();
        const consideration = (order.consideration as Array<Record<string, unknown>>).map((item, index) =>
            index === 0 ? { ...item, recipient: account.address } : item,
        );
        const transport = new RoutedMarketTransport({
            [MarketRoute.MyListings]: [reply(200, listingsPageWire([], null))],
            [MarketRoute.Prepare]: [
                reply(
                    200,
                    preparedWire({
                        order: { ...order, offerer: account.address, consideration },
                    }),
                ),
            ],
            [MarketRoute.Submit]: [reply(200, submittedWire({ maker: account.address }))],
        });
        const requestWalletSign = vi.fn(async (args: unknown) => {
            const typedData = (
                args as {
                    intent: {
                        op: 'typedData';
                        typedData: Parameters<typeof account.signTypedData>[0];
                    };
                }
            ).intent.typedData;
            const signature = await account.signTypedData(typedData);
            return {
                status: 'success',
                output: {
                    output_type: 'signature',
                    credential_id: 'credential-a',
                    value: { signature },
                },
            };
        });
        const factory: PayboxSdkClientFactory = {
            create: vi.fn(() => ({ listCredentials: vi.fn(), requestWalletSign }) as unknown as PayboxSdkClient),
        };
        const rpc: IPayboxRpcClient = {
            getPendingNonce: vi.fn(async () => 1),
            estimateEip1559Fees: vi.fn(async () => ({ maxPriorityFeePerGas: 1n, maxFeePerGas: 2n })),
            estimateGas: vi.fn(async () => 21_000n),
            sendRawTransaction: vi.fn(async (_serialized: Hex) => transactionHash),
            getGasPrice: vi.fn(async () => 1n),
            waitForReceipt: vi.fn(async () => ({
                status: TxStatus.Success,
                transactionHash,
                blockNumber: 1n,
                logs: [],
            })),
            getTransactionSender: vi.fn(async () => account.address),
            readContract: vi.fn(async (params) => {
                if (params.functionName === 'information') {
                    return ['1.6', `0x${'0'.repeat(64)}`, CONDUIT_REGISTRY];
                }
                if (params.functionName === 'getConduit') {
                    return [CONDUIT, true];
                }
                throw new Error(`unexpected contract read: ${params.functionName}`);
            }),
            getBalance: vi.fn(async () => 0n),
        };
        const sdk = new PayboxSdkAdapter(factory);
        const wallet = new PayboxWalletManager({
            sdk,
            credentialId: 'credential-a',
            address: account.address,
            authority: { current: async () => ({ tokens, signingKey: 'pbxk1.key' }), invalidate: vi.fn() },
            rpc,
            logger: new NoopLogger(),
        });
        const provider: WalletProvider = { get: () => wallet, isReady: () => true };
        const logger = new NoopLogger();
        const client = new MarketApiClient({ api: transport, logger });
        const service = new MarketListingService({
            client,
            profile: new MarketProfileClient({ client, chainId: LAUNCH_CHAIN_ID, logger }),
            appConfig: new FakeAppConfig(),
            wallet: provider,
            network: 'robinhood',
            singleFlight: new MarketSingleFlight(),
            recovery: new MarketRecoveryStore(),
            logger,
        });
        const tool = captureMarketTool(createListCellTool, { marketListing: service });

        const result = await tool.handler(listCellArgs());

        expect(result.structuredContent.status).toBe(MarketActionStatus.Completed);
        expect(requestWalletSign).toHaveBeenCalledOnce();
        expect(requestWalletSign).toHaveBeenCalledWith(
            {
                credentialId: 'credential-a',
                intent: {
                    op: 'typedData',
                    typedData: expect.objectContaining({
                        primaryType: 'OrderComponents',
                        domain: expect.objectContaining({ chainId: LAUNCH_CHAIN_ID }),
                    }),
                },
            },
            { autoSign: true },
        );
        const submit = transport.calls.find((call) => call.path === SUBMIT_PATH);
        expect(submit?.body).toEqual(
            expect.objectContaining({
                signature: expect.stringMatching(/^0x[0-9a-f]{130}$/),
            }),
        );
    });
});
