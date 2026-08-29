import { formatEther, parseEther, zeroAddress, type Address, type Hash, type Hex } from 'viem';
import { describe, expect, it } from 'vitest';

import { CPU_HOOK, CPU_TOKEN, FakeAllowance, FakeAppConfig, LAND, WALLET_ADDRESS } from './service-fakes.js';
import { RandomnessKind } from '../../api/types.js';
import { Network } from '../../config/types.js';
import { NoopLogger } from '../../logger/noop.logger.js';
import {
    type ReadContractParams,
    type TransactionRequest,
    type TxReceipt,
    TxStatus,
    type WalletManager,
    type WalletProvider,
} from '../../wallet/types.js';
import { PERMIT2_ADDRESS } from '../swap.constants.js';
import { SwapService } from '../swap.service.js';
import { SwapDirection, SwapToken, type AppConfig, type AppContracts } from '../types.js';
import { universalRouterAddress } from '../uniswap.utils.js';

const BASE_CHAIN_ID = 8453;
const APPROVE_HASH = `0x${'e'.repeat(64)}` as Hash;

interface ReadResponses {
    poolKey: () => unknown;
    quoteAmountOut: bigint;
    permitAllowance: readonly [bigint, number, number];
}

class SwapWallet implements WalletManager, WalletProvider {
    public readonly sent: Array<TransactionRequest> = [];
    public readonly reads: Array<ReadContractParams> = [];
    private receiptIndex = 0;

    constructor(
        private readonly responses: Partial<ReadResponses>,
        private readonly receipts: Array<TxStatus> = [],
        private readonly chainId: number = BASE_CHAIN_ID,
    ) {}

    get(): WalletManager {
        return this;
    }
    isReady(): boolean {
        return true;
    }
    getAddress(): Address {
        return WALLET_ADDRESS;
    }
    getChainId(): number {
        return this.chainId;
    }
    async sendTransaction(tx: TransactionRequest): Promise<Hash> {
        this.sent.push(tx);
        return `0x${String(this.sent.length).padStart(64, '0')}` as Hash;
    }
    async estimateGas(): Promise<bigint> {
        return 21000n;
    }
    async getGasPrice(): Promise<bigint> {
        return 1_000_000_000n;
    }
    async waitForReceipt(hash: Hash): Promise<TxReceipt> {
        const status = this.receipts[this.receiptIndex] ?? TxStatus.Success;
        this.receiptIndex += 1;
        return { status, transactionHash: hash, blockNumber: 100n, logs: [] };
    }
    async readContract(params: ReadContractParams): Promise<unknown> {
        this.reads.push(params);
        if (params.functionName === 'poolKey') {
            const fn =
                this.responses.poolKey ??
                ((): unknown => ({
                    currency0: zeroAddress,
                    currency1: CPU_TOKEN as Address,
                    fee: 0,
                    tickSpacing: 60,
                    hooks: CPU_HOOK as Address,
                }));
            return fn();
        }
        if (params.functionName === 'quoteExactInputSingle') {
            return [this.responses.quoteAmountOut ?? parseEther('2000'), 50_000n] as const;
        }
        if (params.functionName === 'allowance') {
            return this.responses.permitAllowance ?? ([0n, 0, 0] as const);
        }
        throw new Error(`unexpected read: ${params.functionName}`);
    }
    async getBalance(): Promise<bigint> {
        return 0n;
    }
    async signMessage(): Promise<Hex> {
        return '0x';
    }
}

function makeConfig(contracts: Partial<AppContracts> = {}): AppConfig {
    return {
        network: Network.BASE,
        chainId: BASE_CHAIN_ID,
        contracts: {
            land: LAND,
            cpuToken: CPU_TOKEN,
            cpuHook: CPU_HOOK,
            cell: '',
            cellLens: '',
            transport: '',
            trade: '',
            syndicate: null,
            ...contracts,
        },
        randomness: { kind: RandomnessKind.ENTROPY, adapter: '' },
        resources: {},
        recipes: [],
        buildings: [],
        reveal: { ethBudget: '0', cpuBurn: '0' },
        transport: { moveRadius: 1, hubRadius: 3, moveTimePerCellSec: 2, moveFeeFloors: {} },
        trade: { saleBurnPercent: 1, maxSaleFeePercent: 50 },
        storage: { caps: [{ resourceId: 1, cellCap: 100, hubCap: 1000 }] },
    };
}

function makeService(
    wallet: SwapWallet,
    allowance: FakeAllowance = new FakeAllowance(APPROVE_HASH),
    config: AppConfig = makeConfig(),
): SwapService {
    return new SwapService({
        wallet,
        appConfig: new FakeAppConfig(config),
        allowance,
        logger: new NoopLogger(),
    });
}

describe('SwapService', () => {
    describe('error cases', () => {
        it('throws when the hook is not configured', async () => {
            const service = makeService(new SwapWallet({}), undefined, makeConfig({ cpuHook: '' }));
            await expect(service.quote({ sell: SwapToken.ETH, amount: '1', slippage: 0.5 })).rejects.toThrow(
                /hook is not configured/i,
            );
        });

        it('throws a clear error when the pool is not initialized (poolKey reverts)', async () => {
            const wallet = new SwapWallet({
                poolKey: () => {
                    throw new Error('PoolNotLatched');
                },
            });
            await expect(
                makeService(wallet).quote({ sell: SwapToken.ETH, amount: '1', slippage: 0.5 }),
            ).rejects.toThrow(/not be initialized/i);
        });

        it('throws when the on-chain swap reverts', async () => {
            const wallet = new SwapWallet({}, [TxStatus.Reverted]);
            await expect(makeService(wallet).swap({ sell: SwapToken.ETH, amount: '1', slippage: 0.5 })).rejects.toThrow(
                /reverted/i,
            );
        });
    });

    describe('quote', () => {
        it('quotes ETH→$CPU net of slippage and reads the pool once across calls', async () => {
            const wallet = new SwapWallet({ quoteAmountOut: parseEther('2000') });
            const service = makeService(wallet);

            const quote = await service.quote({ sell: SwapToken.ETH, amount: '1', slippage: 0.5 });
            await service.quote({ sell: SwapToken.ETH, amount: '1', slippage: 0.5 });

            expect(quote.direction).toBe(SwapDirection.EthToCpu);
            expect(quote.tokenIn).toBe(zeroAddress);
            expect(quote.tokenOut.toLowerCase()).toBe(CPU_TOKEN);
            expect(quote.amountOut).toBe('2000');
            // 0.5% slippage → 2000 * (10000 - 50) / 10000 = 1990
            expect(quote.amountOutMinimum).toBe('1990');

            const poolReads = wallet.reads.filter((r) => r.functionName === 'poolKey');
            expect(poolReads).toHaveLength(1);
        });
    });

    describe('swap ETH→$CPU', () => {
        it('sends one router tx with the ETH value and no approvals', async () => {
            const allowance = new FakeAllowance(APPROVE_HASH);
            const wallet = new SwapWallet({ quoteAmountOut: parseEther('2000') });
            const result = await makeService(wallet, allowance).swap({
                sell: SwapToken.ETH,
                amount: '0.5',
                slippage: 0.5,
            });

            expect(allowance.calls).toHaveLength(0);
            expect(wallet.sent).toHaveLength(1);
            expect(wallet.sent[0]?.to.toLowerCase()).toBe(universalRouterAddress(BASE_CHAIN_ID).toLowerCase());
            expect(wallet.sent[0]?.value).toBe(parseEther('0.5'));
            expect(result.approveTxHash).toBeNull();
            expect(result.permit2TxHash).toBeNull();
            expect(result.status).toBe(TxStatus.Success);
            expect(result.amountOutQuoted).toBe('2000');
        });
    });

    describe('swap $CPU→ETH', () => {
        it('approves $CPU→Permit2 and Permit2→router, then swaps with no value', async () => {
            const allowance = new FakeAllowance(APPROVE_HASH);
            const wallet = new SwapWallet({ quoteAmountOut: parseEther('3') });
            const result = await makeService(wallet, allowance).swap({
                sell: SwapToken.CPU,
                amount: '1000',
                slippage: 0.5,
            });

            expect(allowance.calls).toEqual([
                { token: CPU_TOKEN, spender: PERMIT2_ADDRESS, needed: parseEther('1000') },
            ]);
            // tx 0 = Permit2 approve for the router; tx 1 = the swap
            expect(wallet.sent).toHaveLength(2);
            expect(wallet.sent[0]?.to).toBe(PERMIT2_ADDRESS);
            expect(wallet.sent[1]?.to.toLowerCase()).toBe(universalRouterAddress(BASE_CHAIN_ID).toLowerCase());
            expect(wallet.sent[1]?.value).toBeNull();
            expect(result.direction).toBe(SwapDirection.CpuToEth);
            expect(result.approveTxHash).toBe(APPROVE_HASH);
            expect(result.permit2TxHash).not.toBeNull();
            expect(result.amountOutQuoted).toBe(formatEther(parseEther('3')));
        });

        it('skips the Permit2 approve when an unexpired allowance already covers the amount', async () => {
            const wallet = new SwapWallet({
                quoteAmountOut: parseEther('3'),
                permitAllowance: [2n ** 160n - 1n, 9_999_999_999, 0],
            });
            const result = await makeService(wallet).swap({ sell: SwapToken.CPU, amount: '1000', slippage: 0.5 });

            // only the swap tx — no Permit2 approve
            expect(wallet.sent).toHaveLength(1);
            expect(wallet.sent[0]?.to.toLowerCase()).toBe(universalRouterAddress(BASE_CHAIN_ID).toLowerCase());
            expect(result.permit2TxHash).toBeNull();
        });
    });
});
