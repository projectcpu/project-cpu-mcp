import type { Address } from 'viem';

// Canonical OpenSea SeaDrop 1.0 router — same address across the supported chains. Mints are sent
// here keyed by the `land` contract; it calls back into the NFT to issue the cells.
export const SEADROP_ADDRESS: Address = '0x00005EA00Ac477B1030CE78506496e8C2dE24bf5';
