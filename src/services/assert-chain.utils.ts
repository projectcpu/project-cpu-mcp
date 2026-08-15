export function assertChain(configChainId: number, walletChainId: number): void {
    if (configChainId !== walletChainId) {
        throw new Error(
            `Chain mismatch: the chain config is chainId ${configChainId} but the wallet is on ${walletChainId}. Check RPC_URL.`,
        );
    }
}
