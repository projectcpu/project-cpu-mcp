import { parseAbi } from 'viem';

// Uniswap Universal Router entry point. `commands` / `inputs` are produced by the Uniswap SDK
// (RoutePlanner / V4Planner); this surface only encodes the `execute` call for sending. `payable` so a
// native-ETH-in swap can attach `value`. Must match the deployed router.
export const UNIVERSAL_ROUTER_ABI = parseAbi([
    'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
]);
