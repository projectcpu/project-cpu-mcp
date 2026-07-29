import { encodeFunctionData, type Address, type Hash } from 'viem';

import { MAX_APPROVE_AMOUNT } from './allowance.constants.js';
import type { AllowanceServiceOptions, IAllowanceService } from './types.js';
import { ERC20_ABI } from '../contracts/erc20.abi.js';
import type { ILogger } from '../logger/types.js';
import { TxStatus, type WalletProvider } from '../wallet/types.js';

/**
 * Manages ERC-20 spending allowances for the wallet. Shared by every action that spends a token through
 * a contract (reveal, build, transport, trade, …) so the approve logic lives in one place.
 */
export class AllowanceService implements IAllowanceService {
    private readonly wallet: WalletProvider;
    private readonly logger: ILogger;

    constructor(options: AllowanceServiceOptions) {
        this.wallet = options.wallet;
        this.logger = options.logger;
    }

    // Ensure `spender` can pull at least `needed` of `token` from the wallet. Approves an unbounded amount
    // once when the current allowance is short; returns the approve tx hash, or null if none was needed.
    async ensureAllowance(token: Address, spender: Address, needed: bigint): Promise<Hash | null> {
        const wallet = this.wallet.get();

        const allowance = (await wallet.readContract({
            address: token,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [wallet.getAddress(), spender],
        })) as bigint;

        if (allowance >= needed) {
            this.logger.info('allowance already sufficient — skipping approve', {
                token,
                spender,
                allowance: allowance.toString(),
            });
            return null;
        }

        const data = encodeFunctionData({
            abi: ERC20_ABI,
            functionName: 'approve',
            args: [spender, MAX_APPROVE_AMOUNT],
        });
        this.logger.info('approving max allowance once', { token, spender });
        const hash = await wallet.sendTransaction({ to: token, data, value: null, gas: null });
        const receipt = await wallet.waitForReceipt(hash);

        if (receipt.status === TxStatus.Reverted) {
            throw new Error(`Approve transaction reverted on-chain (tx ${hash}).`);
        }
        return hash;
    }
}
