import type { Address } from 'viem';

// Permit2 — same canonical address on every chain.
export const PERMIT2_ADDRESS = '0x000000000022D473030F116dDEE9F6B43aC78BA3' as Address;

// Permit2 `approve` caps: amount is a uint160, expiration a uint48. Granting the max of each once lets
// later swaps reuse the allowance instead of paying for another approve.
export const MAX_UINT160 = 2n ** 160n - 1n;
export const MAX_UINT48 = 2 ** 48 - 1;

export const SWAP_DEADLINE_SECONDS = 1800;
