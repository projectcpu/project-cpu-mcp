import { parseAbi } from 'viem';

export const CPU_HOOK_ABI = parseAbi([
    'function poolKey() view returns ((address currency0, address currency1, uint24 fee, int24 tickSpacing, address hooks))',
    'function isLatched() view returns (bool)',
]);
