import { formatEther, isAddress } from 'viem';

import type { BalanceResult, BalanceServiceOptions, IAppConfig } from './types.js';
import { ERC20_ABI } from '../contracts/erc20.abi.js';
import type { ILogger } from '../logger/types.js';
import type { WalletProvider } from '../wallet/types.js';

/**
 * Reads the wallet's spendable funds so the agent can size paid actions before committing: $CPU (the
 * game currency, an ERC-20) via `balanceOf`, and native gas via the chain's balance. Both are on-chain
 * reads — no API call.
 */
export class BalanceService {
    private readonly wallet: WalletProvider;
    private readonly appConfig: IAppConfig;
    private readonly logger: ILogger;

    constructor(options: BalanceServiceOptions) {
        this.wallet = options.wallet;
        this.appConfig = options.appConfig;
        this.logger = options.logger;
    }

    async getBalances(): Promise<BalanceResult> {
        const config = await this.appConfig.load();
        const wallet = this.wallet.get();
        const address = wallet.getAddress();

        const cpuToken = config.contracts.cpuToken;
        if (!isAddress(cpuToken, { strict: false })) {
            throw new Error(
                `$CPU token is not configured for network ${config.network}; cannot read the $CPU balance.`,
            );
        }

        const cpuWei = (await wallet.readContract({
            address: cpuToken,
            abi: ERC20_ABI,
            functionName: 'balanceOf',
            args: [address],
        })) as bigint;
        const nativeWei = await wallet.getBalance();

        this.logger.info('read balances', { address, network: config.network });
        return {
            address,
            network: config.network,
            chainId: config.chainId,
            cpu: formatEther(cpuWei),
            native: formatEther(nativeWei),
        };
    }
}
