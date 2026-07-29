import type { Chain } from 'viem';
import { base, baseSepolia, mainnet, robinhood, sepolia } from 'viem/chains';

// Inverse of config/network.utils: the numeric chainId the wallet carries → its viem `Chain`, used to
// build the wallet/public clients. Kept in sync with the supported `Network` set.
const CHAIN_BY_ID: Record<number, Chain> = {
    [mainnet.id]: mainnet,
    [sepolia.id]: sepolia,
    [base.id]: base,
    [baseSepolia.id]: baseSepolia,
    [robinhood.id]: robinhood,
};

export function viemChainForChainId(chainId: number): Chain {
    const chain = CHAIN_BY_ID[chainId];
    if (chain === undefined) {
        throw new Error(`Unsupported chainId ${chainId} — no viem chain mapping.`);
    }
    return chain;
}
