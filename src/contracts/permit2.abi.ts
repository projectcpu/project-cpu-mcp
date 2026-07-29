import { parseAbi } from 'viem';

// Permit2 (canonical `0x000000000022D473030F116dDEE9F6B43aC78BA3`, same on every chain). The Universal
// Router pulls ERC-20s through Permit2, so a $CPU→ETH swap needs a Permit2 allowance for the router
// (on top of the one-time $CPU→Permit2 ERC-20 approve). `allowance` reports the current grant.
export const PERMIT2_ABI = parseAbi([
    'function allowance(address user, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
    'function approve(address token, address spender, uint160 amount, uint48 expiration)',
]);
