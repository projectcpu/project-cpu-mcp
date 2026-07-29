import { parseAbi } from 'viem';

// Uniswap v4 periphery Quoter. `quoteExactInputSingle` simulates the swap (including the pool's hook)
// and returns the net output — meant to be called with `eth_call` (staticcall), never on-chain. The
// deployed function is non-view; declaring it `view` here lets the read path issue an `eth_call`.
export const V4_QUOTER_ABI = parseAbi([
    'function quoteExactInputSingle(((address currency0, address currency1, uint24 fee, int24 tickSpacing, ' +
        'address hooks) poolKey, bool zeroForOne, uint128 exactAmount, bytes hookData) params) view returns ' +
        '(uint256 amountOut, uint256 gasEstimate)',
]);
