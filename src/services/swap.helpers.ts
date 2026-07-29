import { encodeFunctionData, type Hex } from 'viem';

import type { V4SwapPlan } from './types.js';
import { RoutePlanner, RouterCommand, V4Action, V4Planner } from './uniswap.utils.js';
import { UNIVERSAL_ROUTER_ABI } from '../contracts/universal-router.abi.js';

export function encodeV4ExactInSwap(plan: V4SwapPlan): Hex {
    const v4Planner = new V4Planner();
    v4Planner.addAction(V4Action.SWAP_EXACT_IN_SINGLE, [
        {
            poolKey: plan.poolKey,
            zeroForOne: plan.zeroForOne,
            amountIn: plan.amountInWei.toString(),
            amountOutMinimum: plan.amountOutMinimumWei.toString(),
            hookData: '0x',
        },
    ]);
    v4Planner.addAction(V4Action.SETTLE_ALL, [plan.inputCurrency, plan.amountInWei.toString()]);
    v4Planner.addAction(V4Action.TAKE_ALL, [plan.outputCurrency, plan.amountOutMinimumWei.toString()]);

    const routePlanner = new RoutePlanner();
    routePlanner.addCommand(RouterCommand.V4_SWAP, [v4Planner.actions, v4Planner.params]);

    return encodeFunctionData({
        abi: UNIVERSAL_ROUTER_ABI,
        functionName: 'execute',
        args: [routePlanner.commands as Hex, [v4Planner.finalize() as Hex], plan.deadline],
    });
}

export function applySlippage(amountOut: bigint, slippagePercent: number): bigint {
    const keptBps = BigInt(10_000 - Math.round(slippagePercent * 100));
    return (amountOut * keptBps) / 10_000n;
}
