import { encodeFunctionData, formatEther, zeroAddress, type Address } from 'viem';

import { SEADROP_ADDRESS } from './mint.constants.js';
import { preparePaidAction } from './paid-action.js';
import { AppContract } from './paid-action.types.js';
import {
    type IAppConfig,
    type IMintService,
    type MintInput,
    type MintQuote,
    type MintResult,
    type MintServiceOptions,
    type PreparedMint,
    type PublicDropView,
} from './types.js';
import { SEADROP_ABI } from '../contracts/seadrop.abi.js';
import type { ILogger } from '../logger/types.js';
import { errorMessage } from '../utils/error.utils.js';
import { formatUnixSeconds } from '../utils/format.utils.js';
import { TxStatus, type WalletManager, type WalletProvider } from '../wallet/types.js';

export class MintService implements IMintService {
    private readonly wallet: WalletProvider;
    private readonly appConfig: IAppConfig;
    private readonly logger: ILogger;

    constructor(options: MintServiceOptions) {
        this.wallet = options.wallet;
        this.appConfig = options.appConfig;
        this.logger = options.logger;
    }

    async quote(input: MintInput): Promise<MintQuote> {
        const { land, drop, quantity, totalWei } = await this.prepare(input);
        return {
            land,
            quantity,
            mintPrice: formatEther(drop.mintPrice),
            total: formatEther(totalWei),
            feeBps: drop.feeBps,
            startTime: drop.startTime,
            endTime: drop.endTime,
            maxTotalMintableByWallet: drop.maxTotalMintableByWallet,
        };
    }

    async mint(input: MintInput): Promise<MintResult> {
        const { config, wallet, land, quantity, totalWei } = await this.prepare(input);
        const feeRecipient = await this.resolveFeeRecipient(wallet, land);

        // SeaDrop mints to msg.sender when minterIfNotPayer is the zero address.
        const data = encodeFunctionData({
            abi: SEADROP_ABI,
            functionName: 'mintPublic',
            args: [land, feeRecipient, zeroAddress, BigInt(quantity)],
        });

        this.logger.info('submitting mint', {
            land,
            quantity,
            totalWei: totalWei.toString(),
            network: config.network,
        });
        const txHash = await wallet.sendTransaction({ to: SEADROP_ADDRESS, data, value: totalWei, gas: null });
        const receipt = await wallet.waitForReceipt(txHash);
        if (receipt.status === TxStatus.Reverted) {
            throw new Error(
                `Mint reverted on-chain (tx ${txHash}). The public drop terms may have changed — re-quote and retry.`,
            );
        }

        return {
            land,
            quantity,
            total: formatEther(totalWei),
            txHash,
            status: receipt.status,
            blockNumber: receipt.blockNumber.toString(),
        };
    }

    private async prepare(input: MintInput): Promise<PreparedMint> {
        const action = await preparePaidAction({ appConfig: this.appConfig, wallet: this.wallet });
        const { config, wallet } = action;
        const land = action.requireContract(AppContract.Land, 'cannot mint');

        const quantity = Number(input.quantity);
        const drop = await this.readPublicDrop(wallet, land);

        const now = Math.floor(Date.now() / 1000);
        if (now < drop.startTime) {
            throw new Error(
                `The land public drop has not started yet (opens at ${formatUnixSeconds(drop.startTime)}).`,
            );
        }
        if (drop.endTime !== 0 && now > drop.endTime) {
            throw new Error(`The land public drop has ended (closed at ${formatUnixSeconds(drop.endTime)}).`);
        }
        if (quantity > drop.maxTotalMintableByWallet) {
            throw new Error(
                `Quantity ${quantity} exceeds the per-wallet mint limit of ${drop.maxTotalMintableByWallet} for this drop.`,
            );
        }

        const totalWei = BigInt(quantity) * drop.mintPrice;
        return { config, wallet, land, drop, quantity, totalWei };
    }

    private async readPublicDrop(wallet: WalletManager, land: Address): Promise<PublicDropView> {
        let raw: PublicDropView;
        try {
            raw = (await wallet.readContract({
                address: SEADROP_ADDRESS,
                abi: SEADROP_ABI,
                functionName: 'getPublicDrop',
                args: [land],
            })) as PublicDropView;
        } catch (error) {
            throw new Error(
                `Could not read the land public drop from SeaDrop — the drop may not be initialized: ${errorMessage(error)}`,
            );
        }
        return raw;
    }

    private async resolveFeeRecipient(wallet: WalletManager, land: Address): Promise<Address> {
        const recipients = (await wallet.readContract({
            address: SEADROP_ADDRESS,
            abi: SEADROP_ABI,
            functionName: 'getAllowedFeeRecipients',
            args: [land],
        })) as ReadonlyArray<Address>;

        const [feeRecipient] = recipients;
        if (feeRecipient === undefined) {
            throw new Error('The land public drop has no allowed fee recipient configured; cannot mint.');
        }
        return feeRecipient;
    }
}
