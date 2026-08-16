import { isAddress, type Address } from 'viem';

import { APP_CONTRACT_LABEL } from './paid-action.constants.js';
import type { AppContract, PaidActionContext, PaidActionPreparationOptions } from './paid-action.types.js';

export async function preparePaidAction(options: PaidActionPreparationOptions): Promise<PaidActionContext> {
    const config = await options.appConfig.load();
    const wallet = options.wallet.get();
    const walletChainId = wallet.getChainId();
    if (config.chainId !== walletChainId) {
        throw new Error(
            `Chain mismatch: the chain config is chainId ${config.chainId} but the wallet is on ${walletChainId}. ` +
                `Check RPC_URL. Wallet chain ${walletChainId} does not match the configured network chain ${config.chainId}.`,
        );
    }
    return {
        config,
        wallet,
        requireContract(contract: AppContract, purpose: string): Address {
            const address = config.contracts[contract];
            if (address === null || !isAddress(address, { strict: false })) {
                throw new Error(
                    `${APP_CONTRACT_LABEL[contract]} is not configured for network ${config.network}; ${purpose}.`,
                );
            }
            return address as Address;
        },
    };
}
