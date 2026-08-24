import type { Address } from 'viem';

// Canonical OpenSea SeaDrop 1.0 router — same address across the supported chains. Mints are sent
// here keyed by the `land` contract; it calls back into the NFT to issue the cells.
export const SEADROP_ADDRESS: Address = '0x00005EA00Ac477B1030CE78506496e8C2dE24bf5';

export const NO_PUBLIC_DROP_MESSAGE =
    'The land contract has no mintable public drop right now: the per-wallet allowance on its public drop ' +
    'reads zero on-chain, so nothing can be minted through it at the moment. Read the terms again with ' +
    '`cpu_quote_mint` to see whether that allowance has changed.';
