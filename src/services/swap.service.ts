import { encodeFunctionData, formatEther, isAddress, parseEther, zeroAddress, type Address, type Hash } from 'viem';

import { MAX_UINT160, MAX_UINT48, PERMIT2_ADDRESS, SWAP_DEADLINE_SECONDS } from './swap.constants.js';
import { applySlippage, encodeV4ExactInSwap } from './swap.helpers.js';
import {
    SwapDirection,
    SwapToken,
    type AppConfig,
    type IAllowanceService,
    type IAppConfig,
    type PoolKeyView,
    type PreparedSwap,
    type SwapInput,
    type SwapQuote,
    type SwapResult,
    type SwapRoute,
    type SwapServiceOptions,
} from './types.js';
import { universalRouterAddress, v4QuoterAddress } from './uniswap.utils.js';
import { CPU_HOOK_ABI } from '../contracts/cpu-hook.abi.js';
import { PERMIT2_ABI } from '../contracts/permit2.abi.js';
import { V4_QUOTER_ABI } from '../contracts/v4-quoter.abi.js';
import type { ILogger } from '../logger/types.js';
import { errorMessage } from '../utils/error.utils.js';
import { TxStatus, type WalletManager, type WalletProvider } from '../wallet/types.js';

export class SwapService {
    private readonly wallet: WalletProvider;
    private readonly appConfig: IAppConfig;
    private readonly allowance: IAllowanceService;
    private readonly logger: ILogger;
    private cachedPool: PoolKeyView | null = null;

    constructor(options: SwapServiceOptions) {
        this.wallet = options.wallet;
        this.appConfig = options.appConfig;
        this.allowance = options.allowance;
        this.logger = options.logger;
    }

    invalidateCache(): void {
        this.cachedPool = null;
    }

    async quote(input: SwapInput): Promise<SwapQuote> {
        const prepared = await this.prepare(input);
        return {
            direction: prepared.route.direction,
            sell: input.sell,
            tokenIn: prepared.route.tokenIn,
            tokenOut: prepared.route.tokenOut,
            fee: prepared.pool.fee,
            amountIn: input.amount,
            amountOut: formatEther(prepared.amountOutWei),
            amountOutMinimum: formatEther(prepared.amountOutMinimumWei),
            slippage: input.slippage,
        };
    }

    async swap(input: SwapInput): Promise<SwapResult> {
        const { config, wallet, pool, route, amountInWei, amountOutWei, amountOutMinimumWei } =
            await this.prepare(input);
        const router = universalRouterAddress(config.chainId);

        let approveTxHash: Hash | null = null;
        let permit2TxHash: Hash | null = null;
        let value: bigint | null = null;

        if (input.sell === SwapToken.ETH) {
            value = amountInWei;
        } else {
            approveTxHash = await this.allowance.ensureAllowance(route.tokenIn, PERMIT2_ADDRESS, amountInWei);
            permit2TxHash = await this.ensurePermit2Allowance(wallet, route.tokenIn, router, amountInWei);
        }

        const deadline = BigInt(Math.floor(Date.now() / 1000) + SWAP_DEADLINE_SECONDS);
        const data = encodeV4ExactInSwap({
            poolKey: pool,
            zeroForOne: route.zeroForOne,
            inputCurrency: route.tokenIn,
            outputCurrency: route.tokenOut,
            amountInWei,
            amountOutMinimumWei,
            deadline,
        });

        this.logger.info('submitting swap', {
            direction: route.direction,
            router,
            amountIn: amountInWei.toString(),
            network: config.network,
        });
        const txHash = await wallet.sendTransaction({ to: router, data, value, gas: null });
        const receipt = await wallet.waitForReceipt(txHash);
        if (receipt.status === TxStatus.Reverted) {
            throw new Error(`Swap reverted on-chain (tx ${txHash}). The quote may be stale — re-quote and retry.`);
        }

        return {
            direction: route.direction,
            sell: input.sell,
            tokenIn: route.tokenIn,
            tokenOut: route.tokenOut,
            amountIn: input.amount,
            amountOutQuoted: formatEther(amountOutWei),
            amountOutMinimum: formatEther(amountOutMinimumWei),
            txHash,
            approveTxHash,
            permit2TxHash,
            status: receipt.status,
            blockNumber: receipt.blockNumber.toString(),
        };
    }

    private async prepare(input: SwapInput): Promise<PreparedSwap> {
        const config = await this.appConfig.load();
        const wallet = this.wallet.get();
        this.assertChain(config.chainId, wallet.getChainId());

        const pool = await this.resolvePool(config, wallet);
        const route = this.route(input.sell, pool);
        const amountInWei = parseEther(input.amount);
        const amountOutWei = await this.quoteExactIn(wallet, config.chainId, pool, route.zeroForOne, amountInWei);
        const amountOutMinimumWei = applySlippage(amountOutWei, input.slippage);

        return { config, wallet, pool, route, amountInWei, amountOutWei, amountOutMinimumWei };
    }

    private route(sell: SwapToken, pool: PoolKeyView): SwapRoute {
        const sellingEth = sell === SwapToken.ETH;
        return {
            direction: sellingEth ? SwapDirection.EthToCpu : SwapDirection.CpuToEth,
            tokenIn: sellingEth ? pool.currency0 : pool.currency1,
            tokenOut: sellingEth ? pool.currency1 : pool.currency0,
            zeroForOne: sellingEth,
        };
    }

    private async resolvePool(config: AppConfig, wallet: WalletManager): Promise<PoolKeyView> {
        if (this.cachedPool !== null) {
            return this.cachedPool;
        }

        const hook = config.contracts.cpuHook;
        if (!isAddress(hook, { strict: false })) {
            throw new Error(`Uniswap v4 hook is not configured for network ${config.network}; cannot swap.`);
        }

        let key: PoolKeyView;
        try {
            key = (await wallet.readContract({
                address: hook as Address,
                abi: CPU_HOOK_ABI,
                functionName: 'poolKey',
                args: [],
            })) as PoolKeyView;
        } catch (error) {
            throw new Error(
                `Could not read the ETH/$CPU pool from the hook — it may not be initialized yet: ${errorMessage(error)}`,
            );
        }

        if (key.currency0 !== zeroAddress) {
            throw new Error(`Unexpected pool currency0 ${key.currency0}; expected native ETH (the zero address).`);
        }
        const cpuToken = config.contracts.cpuToken;
        if (isAddress(cpuToken, { strict: false }) && key.currency1.toLowerCase() !== cpuToken.toLowerCase()) {
            throw new Error(`Pool currency1 ${key.currency1} does not match the configured $CPU token ${cpuToken}.`);
        }

        this.logger.info('resolved ETH/$CPU pool', { fee: key.fee, tickSpacing: key.tickSpacing });
        this.cachedPool = key;
        return key;
    }

    private async quoteExactIn(
        wallet: WalletManager,
        chainId: number,
        pool: PoolKeyView,
        zeroForOne: boolean,
        amountInWei: bigint,
    ): Promise<bigint> {
        const quoter = v4QuoterAddress(chainId);
        const result = (await wallet.readContract({
            address: quoter,
            abi: V4_QUOTER_ABI,
            functionName: 'quoteExactInputSingle',
            args: [{ poolKey: pool, zeroForOne, exactAmount: amountInWei, hookData: '0x' }],
        })) as readonly [bigint, bigint];
        return result[0];
    }

    private async ensurePermit2Allowance(
        wallet: WalletManager,
        token: Address,
        spender: Address,
        needed: bigint,
    ): Promise<Hash | null> {
        const [amount, expiration] = (await wallet.readContract({
            address: PERMIT2_ADDRESS,
            abi: PERMIT2_ABI,
            functionName: 'allowance',
            args: [wallet.getAddress(), token, spender],
        })) as readonly [bigint, number, number];

        const now = Math.floor(Date.now() / 1000);
        if (amount >= needed && expiration > now) {
            return null;
        }

        const data = encodeFunctionData({
            abi: PERMIT2_ABI,
            functionName: 'approve',
            args: [token, spender, MAX_UINT160, MAX_UINT48],
        });
        const hash = await wallet.sendTransaction({ to: PERMIT2_ADDRESS, data, value: null, gas: null });
        const receipt = await wallet.waitForReceipt(hash);
        if (receipt.status === TxStatus.Reverted) {
            throw new Error(`Permit2 approve reverted on-chain (tx ${hash}).`);
        }
        return hash;
    }

    private assertChain(configChainId: number, walletChainId: number): void {
        if (configChainId !== walletChainId) {
            throw new Error(
                `Wallet chain ${walletChainId} does not match the configured network chain ${configChainId}.`,
            );
        }
    }
}
