import { arbitrum, base, baseSepolia, mainnet, robinhood, sepolia } from 'viem/chains';

import { Network } from './types.js';

// Maps a `Network` to its numeric EVM chainId, which feeds the EIP-712 domain and on-chain replay
// protection. Adding a chain is an isolated change here + in wallet/chain.utils.
const CHAIN_ID_BY_NETWORK: Record<Network, number> = {
    [Network.ETHEREUM]: mainnet.id,
    [Network.ETHEREUM_SEPOLIA]: sepolia.id,
    [Network.BASE]: base.id,
    [Network.BASE_SEPOLIA]: baseSepolia.id,
    [Network.ROBINHOOD]: robinhood.id,
    [Network.ARBITRUM]: arbitrum.id,
};

export function chainIdForNetwork(network: Network): number {
    return CHAIN_ID_BY_NETWORK[network];
}
